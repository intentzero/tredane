/**
 * Criar cobrança Pix + enviar sinal na conversa sem reservar horário (#38 / DEC-047).
 * Confirmar sem sinal com motivo (AC-51). Sem hold; pagamento = #39; expiração = #40.
 */
import type { Clock } from '../../db/clock'
import type { PixProviderAdapter } from '../../pix/contract'
import { computeSignalAmountCents } from '../../pix/money'
import type { PixCharge as ProviderPixCharge } from '../../pix/types'
import { writeOperationalAudit } from '../audit'
import { getContact } from '../contacts'
import { getResource } from '../config/resources'
import { getService } from '../config/services'
import { quoteVisit, readZoneSnapshots, writeZoneSnapshots, zoneLabel } from '../config/zones'
import { ensureClinicSettings } from '../config/settings'
import { occupiedMinutes } from '../config/validation'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { newId } from '../ids'
import { insertMessage } from '../inbox/messages'
import { sendOutboundMessageOp } from '../inbox/operations'
import { requireConversation } from '../inbox/conversations'
import { messagingWindowForConversation } from '../inbox/window'
import { touchConversationMessage } from '../inbox/conversations'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import { moveOpportunityStageOp } from '../pipeline/operations'
import { confirmAppointmentOp } from '../scheduling/booking'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { getPixAccount, toPixAccountPublic } from './account'
import {
  applyProviderChargeResult,
  getPixCharge,
  getPixChargeByIdempotencyKey,
  insertPendingSignalCharge,
  linkChargeMessage,
  listPixChargesForConversation,
  markChargeCancelled,
  markChargeWhatsappError,
} from './charges'
import { findPixChargeCommand, savePixChargeCommand } from './charge-commands'
import {
  createSchedulingIntent,
  getSchedulingIntent,
  listOpenSchedulingIntentsForConversation,
  updateSchedulingIntent,
  setIntentActiveCharge,
} from './intents'
import { getPixSignalSettings } from './signal-settings'
import type {
  ConfirmWithoutSignalInput,
  ConfirmWithoutSignalResult,
  CreateSignalChargeInput,
  PixChargeRow,
  SchedulingIntentRow,
  SignalChargeResult,
} from './types'

export type SignalChargeAdapterDeps = {
  /** Adaptador já autenticado na conta da clínica (Woovi ou Simulated). */
  adapter: PixProviderAdapter
}

function requireActor(caller: ClinicCaller, actorId: string): string {
  if (!caller.actorId && !actorId.trim()) {
    throw new ValidationError('actor_required', 'Actor obrigatório')
  }
  return actorId.trim() || caller.actorId!
}

function requireClientRequestId(id: string): string {
  const trimmed = id?.trim()
  if (!trimmed) {
    throw new ValidationError(
      'client_request_id_required',
      'clientRequestId obrigatório para idempotência',
    )
  }
  return trimmed
}

function formatBrl(cents: number): string {
  const reais = Math.trunc(cents / 100)
  const rest = Math.abs(cents % 100)
    .toString()
    .padStart(2, '0')
  return `R$ ${reais},${rest}`
}

function formatSlotLocal(startsAt: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(startsAt))
  } catch {
    return new Date(startsAt).toISOString()
  }
}

function formatDeadline(seconds: number): string {
  if (seconds % 3600 === 0) {
    const h = seconds / 3600
    return h === 1 ? '1 hora' : `${h} horas`
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60} minutos`
  }
  return `${seconds} segundos`
}

function buildFreeTextBody(input: {
  contactName: string
  clinicName: string
  serviceName: string
  slotLabel: string
  amountLabel: string
  deadlineLabel: string
  policy: string
  pixCopyPaste: string
  totalLabel?: string | null
}): string {
  const policyLine = input.policy.trim()
    ? `\nPolítica de cancelamento: ${input.policy.trim()}`
    : ''
  const totalLine = input.totalLabel ? ` Total da visita: ${input.totalLabel}.` : ''
  return (
    `Olá, ${input.contactName}! Sinal de ${input.amountLabel} por Pix para ` +
    `${input.serviceName} em ${input.slotLabel} na ${input.clinicName}.` +
    `${totalLine} ` +
    `Prazo para pagar: ${input.deadlineLabel}.${policyLine}\n` +
    `Pix copia-e-cola:\n${input.pixCopyPaste}\n` +
    `O horário só fica reservado após o pagamento.`
  )
}

function expiresAtMsFromProvider(
  expiresAt: string,
  fallbackMs: number,
): number {
  const parsed = Date.parse(expiresAt)
  return Number.isFinite(parsed) ? parsed : fallbackMs
}

function buildResultPayload(
  intent: SchedulingIntentRow,
  charge: PixChargeRow,
  messageId: string | null,
  outboundMessageId: string | null,
  whatsappSendError: string | null,
): SignalChargeResult {
  return {
    intent,
    charge,
    messageId,
    outboundMessageId,
    whatsappSendError,
    outbox: [],
    idempotentReplay: true,
  }
}

/**
 * Fase A (TX): intenção + cobrança pending.
 * Fase B: createCharge fora da TX.
 * Fase C: aplicar resultado + WhatsApp (falha WA não cancela cobrança).
 */
export async function createSignalChargeAndSendOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: CreateSignalChargeInput,
  clock: Clock,
  deps: SignalChargeAdapterDeps,
): Promise<SignalChargeResult> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const clientRequestId = requireClientRequestId(input.clientRequestId)
  const actorId = requireActor(caller, input.actorClerkUserId)

  const existingCmd = findPixChargeCommand(db, meta.tenantId, clientRequestId)
  if (existingCmd) {
    if (existingCmd.command !== 'create_and_send') {
      throw new ConflictError(
        'client_request_id_reuse',
        'clientRequestId já usado noutra operação',
      )
    }
    const parsed = JSON.parse(existingCmd.resultJson) as SignalChargeResult
    const charge = existingCmd.chargeId
      ? getPixCharge(db, meta.tenantId, existingCmd.chargeId)
      : null
    const intent = existingCmd.schedulingIntentId
      ? getSchedulingIntent(db, meta.tenantId, existingCmd.schedulingIntentId)
      : null
    if (charge && intent) {
      return {
        ...parsed,
        intent,
        charge,
        outbox: [],
        idempotentReplay: true,
      }
    }
    return { ...parsed, outbox: [], idempotentReplay: true }
  }

  // Retry sem comando gravado (ex.: falha a meio): reutiliza cobrança pela chave.
  const priorCharge = getPixChargeByIdempotencyKey(
    db,
    meta.tenantId,
    clientRequestId,
  )
  if (priorCharge?.providerCreateState === 'confirmed') {
    const intent = priorCharge.schedulingIntentId
      ? getSchedulingIntent(db, meta.tenantId, priorCharge.schedulingIntentId)
      : null
    if (intent) {
      return {
        intent,
        charge: priorCharge,
        messageId: priorCharge.messageId,
        outboundMessageId: priorCharge.outboundMessageId,
        whatsappSendError: priorCharge.whatsappSendError,
        outbox: [],
        idempotentReplay: true,
      }
    }
  }

  // —— Phase A: prepare (TX) ——
  const prepared = db.transactionSync(() => {
    if (priorCharge) {
      const intent = priorCharge.schedulingIntentId
        ? getSchedulingIntent(db, meta.tenantId, priorCharge.schedulingIntentId)
        : null
      if (!intent) {
        throw new ConflictError(
          'charge_without_intent',
          'Cobrança órfã sem intenção de agendamento',
        )
      }
      const account = getPixAccount(db, meta.tenantId)!
      if (!account.accountId) {
        throw new ValidationError(
          'pix_account_not_connected',
          'Sem conta Pix conectada',
        )
      }
      const service = getService(db, meta.tenantId, priorCharge.serviceId!)!
      const settings = getPixSignalSettings(db, meta.tenantId, clock)
      const contact = getContact(db, meta.tenantId, intent.contactId)!
      const snaps = readZoneSnapshots(db, meta.tenantId, 'pix_charge', priorCharge.id)
      return {
        intent,
        charge: priorCharge,
        accountId: account.accountId,
        amountCents: priorCharge.amountCents,
        deadlineSeconds:
          priorCharge.deadlineSecondsSnapshot ?? settings.deadlineSeconds,
        cancellationPolicy:
          priorCharge.cancellationPolicySnapshot ?? settings.cancellationPolicy,
        serviceName: zoneLabel(service.name, snaps),
        totalLabel:
          snaps.length > 0 && priorCharge.servicePriceCentsSnapshot != null
            ? formatBrl(priorCharge.servicePriceCentsSnapshot)
            : null,
        contactName: contact.displayName?.trim() || contact.waId || 'Cliente',
        timezone: intent.timezone,
        expiresAt: priorCharge.expiresAt ?? clock.nowMs() + settings.deadlineSeconds * 1000,
        resume: true as const,
      }
    }
    ensureClinicSettings(db, meta.tenantId, clock)
    const account = getPixAccount(db, meta.tenantId)!
    const publicAccount = toPixAccountPublic(account)
    if (!publicAccount.canCreateCharge || !account.accountId) {
      throw new ValidationError(
        'pix_account_not_connected',
        'Sem conta Pix conectada — a responsável precisa ligar o recebimento (AC-45)',
      )
    }

    const conversation = requireConversation(
      db,
      meta.tenantId,
      input.conversationId,
    )
    const contactId = input.contactId?.trim() || conversation.contactId
    const contact = getContact(db, meta.tenantId, contactId)
    if (!contact) {
      throw new NotFoundError(
        'contact_not_found',
        `contacto ${contactId} não encontrado nesta clínica`,
      )
    }

    const service = getService(db, meta.tenantId, input.serviceId)
    if (!service || !service.active) {
      throw new NotFoundError(
        'service_not_found',
        `serviço ${input.serviceId} não encontrado ou inactivo`,
      )
    }
    if (!service.requiresSignal) {
      throw new ValidationError(
        'signal_not_required',
        'Este serviço não exige sinal — use Confirmar',
      )
    }
    const visit = quoteVisit(db, meta.tenantId, service, input.zoneIds)
    const amount = computeSignalAmountCents(
      {
        requiresSignal: true,
        kind: service.signalKind,
        fixedCents: service.signalFixedCents,
        percent: service.signalPercent,
      },
      visit.priceCents,
    )
    if (!amount.ok) {
      throw new ValidationError(amount.code, amount.message)
    }
    if (!service.signalKind) {
      throw new ValidationError('signal_incomplete', 'sinal sem tipo configurado')
    }

    const pro = getResource(db, meta.tenantId, input.professionalId, clock)
    if (!pro || pro.kind !== 'professional' || !pro.active) {
      throw new ValidationError(
        'invalid_professional',
        'Profissional inválido ou inactivo',
      )
    }
    if (input.roomResourceId) {
      const room = getResource(db, meta.tenantId, input.roomResourceId, clock)
      if (
        !room
        || (room.kind !== 'room' && room.kind !== 'equipment')
        || !room.active
      ) {
        throw new ValidationError('invalid_room', 'Sala/equipamento inválido')
      }
    }

    const settings = getPixSignalSettings(db, meta.tenantId, clock)
    const clinicSettings = ensureClinicSettings(db, meta.tenantId, clock)
    const occMin = occupiedMinutes(visit.durationMinutes, service.bufferMinutes)
    const endsAt = input.startsAt + visit.durationMinutes * 60_000
    const occupiesUntil = input.startsAt + occMin * 60_000
    const expiresAt = clock.nowMs() + settings.deadlineSeconds * 1000

    const chargeId = newId('pixchg')
    const intent = createSchedulingIntent(
      db,
      meta.tenantId,
      {
        conversationId: conversation.id,
        contactId,
        opportunityId: input.opportunityId ?? null,
        serviceId: service.id,
        professionalId: input.professionalId,
        roomResourceId: input.roomResourceId ?? null,
        startsAt: input.startsAt,
        endsAt,
        occupiesUntil,
        timezone: clinicSettings.timezone,
        createdByClerkUserId: actorId,
        activeChargeId: chargeId,
      },
      clock,
    )

    const charge = insertPendingSignalCharge(
      db,
      meta.tenantId,
      {
        id: chargeId,
        accountId: account.accountId,
        provider: account.provider,
        externalReference: chargeId,
        idempotencyKey: clientRequestId,
        amountCents: amount.amountCents,
        serviceId: service.id,
        schedulingIntentId: intent.id,
        conversationId: conversation.id,
        contactId,
        opportunityId: input.opportunityId ?? null,
        professionalId: input.professionalId,
        roomResourceId: input.roomResourceId ?? null,
        startsAt: input.startsAt,
        endsAt,
        occupiesUntil,
        timezone: clinicSettings.timezone,
        cancellationPolicySnapshot: settings.cancellationPolicy,
        deadlineSecondsSnapshot: settings.deadlineSeconds,
        signalKindSnapshot: service.signalKind,
        signalFixedCentsSnapshot: service.signalFixedCents,
        signalPercentSnapshot: service.signalPercent,
        servicePriceCentsSnapshot: visit.priceCents,
        createdByClerkUserId: actorId,
        expiresAt,
      },
      clock,
    )
    if (visit.zones.length > 0) {
      writeZoneSnapshots(db, meta.tenantId, 'pix_charge', charge.id, visit.zones)
      writeZoneSnapshots(db, meta.tenantId, 'scheduling_intent', intent.id, visit.zones)
    }

    return {
      intent,
      charge,
      accountId: account.accountId,
      amountCents: amount.amountCents,
      deadlineSeconds: settings.deadlineSeconds,
      cancellationPolicy: settings.cancellationPolicy,
      serviceName: zoneLabel(service.name, visit.zones),
      totalLabel: visit.zones.length > 0 && visit.priceCents != null ? formatBrl(visit.priceCents) : null,
      contactName: contact.displayName?.trim() || contact.waId || 'Cliente',
      timezone: clinicSettings.timezone,
      expiresAt,
      resume: false as const,
    }
  })

  // —— Phase B: provider (fora da TX) ——
  // Se já confirmado (resume após WA falhou), salta createCharge.
  let providerResult:
    | { ok: true; value: ProviderPixCharge }
    | Awaited<ReturnType<PixProviderAdapter['createCharge']>>

  if (
    prepared.resume
    && prepared.charge.providerCreateState === 'confirmed'
    && prepared.charge.providerChargeId
    && prepared.charge.pixCopyPaste
  ) {
    providerResult = {
      ok: true,
      value: {
        providerChargeId: prepared.charge.providerChargeId,
        tenantId: meta.tenantId,
        accountId: prepared.accountId,
        amountCents: prepared.amountCents,
        status: 'awaiting_payment',
        externalReference: prepared.charge.externalReference,
        pixCopyPaste: prepared.charge.pixCopyPaste,
        expiresAt: new Date(prepared.expiresAt).toISOString(),
        createdAt: new Date(prepared.charge.createdAt).toISOString(),
      },
    }
  } else {
    providerResult = await deps.adapter.createCharge({
      tenantId: meta.tenantId,
      accountId: prepared.accountId,
      amountCents: prepared.amountCents,
      expiresInSeconds: prepared.deadlineSeconds,
      idempotencyKey: clientRequestId,
      externalReference: prepared.charge.id,
    })
  }

  // —— Phase C: apply + WhatsApp ——
  const outbox: OutboxRow[] = []
  let charge = prepared.charge
  let intent = prepared.intent
  let messageId: string | null = prepared.charge.messageId
  let outboundMessageId: string | null = prepared.charge.outboundMessageId
  let whatsappSendError: string | null = prepared.charge.whatsappSendError

  if (providerResult.ok) {
    const alreadyConfirmed =
      prepared.charge.providerCreateState === 'confirmed'
      && Boolean(prepared.charge.providerChargeId)

    if (!alreadyConfirmed) {
      const applied = db.transactionSync(() => {
        const updated = applyProviderChargeResult(
          db,
          meta.tenantId,
          prepared.charge.id,
          {
            state: 'confirmed',
            providerChargeId: providerResult.value.providerChargeId,
            pixCopyPaste: providerResult.value.pixCopyPaste,
            expiresAt: expiresAtMsFromProvider(
              providerResult.value.expiresAt,
              prepared.expiresAt,
            ),
          },
          clock,
        )
        const createdEvt = insertOutboxEvent(
          db,
          {
            tenantId: meta.tenantId,
            type: 'cobranca.criada',
            aggregateType: 'pix_charge',
            aggregateId: updated.id,
            idempotencyKey: `cobranca.criada:${clientRequestId}`,
            payload: {
              chargeId: updated.id,
              intentId: prepared.intent.id,
              conversationId: prepared.intent.conversationId,
              amountCents: updated.amountCents,
              expiresAt: updated.expiresAt,
              status: updated.status,
              providerCreateState: updated.providerCreateState,
            },
          },
          clock,
        )
        outbox.push(createdEvt)

        const sys = insertMessage(
          db,
          {
            tenantId: meta.tenantId,
            conversationId: prepared.intent.conversationId,
            direction: 'system',
            body: 'Aguardando sinal — horário não reservado',
            deliveryState: 'delivered',
            authorClerkUserId: actorId,
            createdAt: clock.nowMs(),
          },
          clock,
        )
        touchConversationMessage(db, {
          tenantId: meta.tenantId,
          conversationId: prepared.intent.conversationId,
          preview: sys.body,
          direction: 'system',
          at: sys.createdAt,
          bumpUnread: false,
          reopenIfClosed: false,
        })

        writeOperationalAudit(
          db,
          {
            tenantId: meta.tenantId,
            actor: actorId,
            action: 'pix.charge_created',
            objectType: 'pix_charge',
            objectId: updated.id,
            detail: {
              intentId: prepared.intent.id,
              amountCents: updated.amountCents,
              startsAt: prepared.intent.startsAt,
              noAllocation: true,
            },
          },
          clock,
        )
        return updated
      })
      charge = applied

      if (input.opportunityId) {
        try {
          const moved = moveOpportunityStageOp(
            db,
            caller,
            {
              opportunityId: input.opportunityId,
              toStage: 'horario_proposto',
              actorClerkUserId: actorId,
              actorDisplayName: input.authorDisplayName ?? 'Atendente',
              note: 'Aguardando sinal (horário não reservado)',
            },
            clock,
          )
          outbox.push(...moved.outbox)
        } catch {
          // Oportunidade inválida/fechada não bloqueia cobrança.
        }
      }
    } else {
      charge = getPixCharge(db, meta.tenantId, prepared.charge.id)!
    }

    // WhatsApp — request id separado (falha ≠ duplicar cobrança)
    if (!charge.messageId) {
      const waRequestId = `${clientRequestId}:wa`
      const window = messagingWindowForConversation(
        db,
        meta.tenantId,
        prepared.intent.conversationId,
        clock.nowMs(),
      )
      const amountLabel = formatBrl(prepared.amountCents)
      const slotLabel = formatSlotLocal(prepared.intent.startsAt, prepared.timezone)
      const deadlineLabel = formatDeadline(prepared.deadlineSeconds)
      const pixCode = charge.pixCopyPaste ?? ''

      try {
        const sendInput = window.open
          ? {
              conversationId: prepared.intent.conversationId,
              clientRequestId: waRequestId,
              body: buildFreeTextBody({
                contactName: prepared.contactName,
                clinicName: 'clínica',
                serviceName: prepared.serviceName,
                slotLabel,
                amountLabel,
                deadlineLabel,
                policy: prepared.cancellationPolicy,
                pixCopyPaste: pixCode,
                totalLabel: prepared.totalLabel,
              }),
              authorClerkUserId: actorId,
              authorDisplayName: input.authorDisplayName ?? 'Atendente',
            }
          : {
              conversationId: prepared.intent.conversationId,
              clientRequestId: waRequestId,
              template: {
                name: 'tredane_cobranca_sinal_pix',
                language: 'pt_BR',
                params: {
                  nome_contato: prepared.contactName,
                  nome_clinica: 'clínica',
                  servico: prepared.totalLabel
                    ? `${prepared.serviceName} (total ${prepared.totalLabel})`
                    : prepared.serviceName,
                  data_hora: slotLabel,
                  valor_sinal: amountLabel,
                  prazo_pagamento: deadlineLabel,
                  link_ou_codigo_pix: pixCode,
                },
              },
              authorClerkUserId: actorId,
              authorDisplayName: input.authorDisplayName ?? 'Atendente',
            }

        const sent = sendOutboundMessageOp(db, caller, sendInput, clock)
        outbox.push(...sent.outbox)
        messageId = sent.value.message.id
        outboundMessageId = sent.value.outbound.id
        charge = db.transactionSync(() =>
          linkChargeMessage(
            db,
            meta.tenantId,
            charge.id,
            messageId!,
            outboundMessageId!,
            clock,
            null,
          ),
        )
        whatsappSendError = null
      } catch (err) {
        whatsappSendError =
          err instanceof Error ? err.message : 'whatsapp_send_failed'
        charge = db.transactionSync(() =>
          markChargeWhatsappError(
            db,
            meta.tenantId,
            charge.id,
            whatsappSendError!,
            clock,
          ),
        )
      }
    }
  } else if (
    providerResult.code === 'uncertain'
    || providerResult.code === 'timeout'
    || providerResult.uncertain
  ) {
    charge = db.transactionSync(() =>
      applyProviderChargeResult(
        db,
        meta.tenantId,
        prepared.charge.id,
        { state: 'uncertain' },
        clock,
      ),
    )
    whatsappSendError = null
  } else {
    charge = db.transactionSync(() => {
      const failed = applyProviderChargeResult(
        db,
        meta.tenantId,
        prepared.charge.id,
        { state: 'failed', message: providerResult.message },
        clock,
      )
      updateSchedulingIntent(
        db,
        meta.tenantId,
        prepared.intent.id,
        { status: 'failed' },
        clock,
      )
      return failed
    })
    intent = getSchedulingIntent(db, meta.tenantId, prepared.intent.id)!
    throw new ValidationError(
      'pix_provider_create_failed',
      providerResult.message
        || 'Não foi possível criar a cobrança agora. Tente de novo ou marque sem sinal.',
      { code: providerResult.code, chargeId: charge.id, intentId: intent.id },
    )
  }

  intent = getSchedulingIntent(db, meta.tenantId, prepared.intent.id)!
  charge = getPixCharge(db, meta.tenantId, charge.id)!

  const result: SignalChargeResult = {
    intent,
    charge,
    messageId,
    outboundMessageId,
    whatsappSendError,
    outbox,
    idempotentReplay: false,
  }

  db.transactionSync(() => {
    savePixChargeCommand(db, {
      tenantId: meta.tenantId,
      clientRequestId,
      command: 'create_and_send',
      schedulingIntentId: intent.id,
      chargeId: charge.id,
      result: {
        intent,
        charge,
        messageId,
        outboundMessageId,
        whatsappSendError,
        idempotentReplay: false,
      },
      createdAt: clock.nowMs(),
    })
  })

  return result
}

/**
 * Reconcilia criação incierta sem nova cobrança cega (mesmo idempotencyKey).
 */
export async function reconcileUncertainChargeOp(
  db: ClinicDb,
  caller: ClinicCaller,
  chargeId: string,
  clock: Clock,
  deps: SignalChargeAdapterDeps & {
    /** Simulated: findChargeByIdempotencyKey; Woovi: get por correlation se conhecido. */
    findByIdempotencyKey?: (
      key: string,
    ) => Promise<{ ok: true; value: ProviderPixCharge } | { ok: false }>
  },
): Promise<SignalChargeResult> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const charge = getPixCharge(db, meta.tenantId, chargeId)
  if (!charge) {
    throw new NotFoundError('pix_charge_not_found', 'Cobrança não encontrada')
  }
  if (charge.providerCreateState !== 'uncertain' && charge.providerCreateState !== 'pending') {
    const intent = charge.schedulingIntentId
      ? getSchedulingIntent(db, meta.tenantId, charge.schedulingIntentId)
      : null
    return buildResultPayload(
      intent ?? ({} as SchedulingIntentRow),
      charge,
      charge.messageId,
      charge.outboundMessageId,
      charge.whatsappSendError,
    )
  }
  if (!charge.idempotencyKey) {
    throw new ValidationError(
      'missing_idempotency_key',
      'Cobrança sem chave para reconciliar',
    )
  }

  let found: ProviderPixCharge | null = null
  if (deps.findByIdempotencyKey) {
    const r = await deps.findByIdempotencyKey(charge.idempotencyKey)
    if (r.ok) found = r.value
  }
  if (!found && charge.providerChargeId) {
    const r = await deps.adapter.getCharge(charge.providerChargeId)
    if (r.ok) found = r.value
  }
  if (!found) {
    // Ainda incerto — não cria segunda cobrança.
    return {
      intent: charge.schedulingIntentId
        ? getSchedulingIntent(db, meta.tenantId, charge.schedulingIntentId)!
        : ({} as SchedulingIntentRow),
      charge,
      messageId: charge.messageId,
      outboundMessageId: charge.outboundMessageId,
      whatsappSendError: charge.whatsappSendError,
      outbox: [],
      idempotentReplay: false,
    }
  }

  const updated = db.transactionSync(() =>
    applyProviderChargeResult(
      db,
      meta.tenantId,
      charge.id,
      {
        state: 'confirmed',
        providerChargeId: found!.providerChargeId,
        pixCopyPaste: found!.pixCopyPaste,
        expiresAt: expiresAtMsFromProvider(
          found!.expiresAt,
          charge.expiresAt ?? clock.nowMs(),
        ),
      },
      clock,
    ),
  )
  const intent = updated.schedulingIntentId
    ? getSchedulingIntent(db, meta.tenantId, updated.schedulingIntentId)!
    : ({} as SchedulingIntentRow)
  return {
    intent,
    charge: updated,
    messageId: updated.messageId,
    outboundMessageId: updated.outboundMessageId,
    whatsappSendError: updated.whatsappSendError,
    outbox: [],
    idempotentReplay: false,
  }
}

/**
 * Confirmar sem sinal (AC-51): motivo obrigatório; cancela cobrança prévia aberta
 * para não produzir dupla reserva quando #39 processar pagamento.
 */
export async function confirmWithoutSignalOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ConfirmWithoutSignalInput,
  clock: Clock,
  deps?: SignalChargeAdapterDeps,
): Promise<ConfirmWithoutSignalResult> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const clientRequestId = requireClientRequestId(input.clientRequestId)
  const actorId = requireActor(caller, input.actorClerkUserId)
  const reason = input.waiveReason?.trim()
  if (!reason) {
    throw new ValidationError(
      'waive_reason_required',
      'Motivo obrigatório para confirmar sem sinal (AC-51)',
    )
  }

  const existingCmd = findPixChargeCommand(db, meta.tenantId, clientRequestId)
  if (existingCmd) {
    if (existingCmd.command !== 'confirm_without_signal') {
      throw new ConflictError(
        'client_request_id_reuse',
        'clientRequestId já usado noutra operação',
      )
    }
    const parsed = JSON.parse(existingCmd.resultJson) as ConfirmWithoutSignalResult
    return { ...parsed, outbox: [], idempotentReplay: true }
  }

  let supersededChargeId: string | null = null
  let waivedIntent: SchedulingIntentRow | null = null

  // Cancelar cobranças/intents abertas da conversa (contrato proposto #38).
  if (input.conversationId) {
    const openIntents = listOpenSchedulingIntentsForConversation(
      db,
      meta.tenantId,
      input.conversationId,
    )
    const openCharges = listPixChargesForConversation(
      db,
      meta.tenantId,
      input.conversationId,
    ).filter((c) => c.status === 'awaiting_payment')

    const toCancel = input.supersedeChargeId
      ? openCharges.filter((c) => c.id === input.supersedeChargeId)
      : openCharges

    for (const c of toCancel) {
      if (c.providerChargeId && deps?.adapter) {
        try {
          await deps.adapter.cancelCharge(c.providerChargeId)
        } catch {
          // Cancela localmente mesmo se provedor falhar — evita #39 confirmar slot.
        }
      }
      db.transactionSync(() => {
        markChargeCancelled(db, meta.tenantId, c.id, clock)
        if (c.schedulingIntentId) {
          updateSchedulingIntent(
            db,
            meta.tenantId,
            c.schedulingIntentId,
            {
              status: 'cancelled',
              activeChargeId: c.id,
            },
            clock,
          )
        }
      })
      supersededChargeId = c.id
    }

    for (const intent of openIntents) {
      if (intent.status === 'awaiting_signal') {
        waivedIntent = updateSchedulingIntent(
          db,
          meta.tenantId,
          intent.id,
          {
            status: 'waived',
            waivedReason: reason,
            waivedByClerkUserId: actorId,
            waivedAt: clock.nowMs(),
          },
          clock,
        )
      }
    }
  }

  const confirmed = confirmAppointmentOp(
    db,
    caller,
    {
      clientRequestId: `${clientRequestId}:apt`,
      serviceId: input.serviceId,
      professionalId: input.professionalId,
      roomResourceId: input.roomResourceId,
      startsAt: input.startsAt,
      contactLabel: input.contactLabel ?? null,
      contactId: input.contactId ?? null,
      conversationId: input.conversationId ?? null,
      opportunityId: input.opportunityId ?? null,
      actorClerkUserId: actorId,
      zoneIds: input.zoneIds,
    },
    clock,
  )

  if (waivedIntent) {
    waivedIntent = updateSchedulingIntent(
      db,
      meta.tenantId,
      waivedIntent.id,
      {
        status: 'waived',
        appointmentId: confirmed.value.id,
        waivedReason: reason,
        waivedByClerkUserId: actorId,
        waivedAt: clock.nowMs(),
      },
      clock,
    )
  } else if (input.conversationId && input.contactId) {
    // Sem intent prévio: regista waive auditável sem hold anterior.
    const settings = ensureClinicSettings(db, meta.tenantId, clock)
    const service = getService(db, meta.tenantId, input.serviceId)!
    const occMin = occupiedMinutes(service.durationMinutes, service.bufferMinutes)
    waivedIntent = createSchedulingIntent(
      db,
      meta.tenantId,
      {
        conversationId: input.conversationId,
        contactId: input.contactId,
        opportunityId: input.opportunityId ?? null,
        serviceId: input.serviceId,
        professionalId: input.professionalId,
        roomResourceId: input.roomResourceId ?? null,
        startsAt: input.startsAt,
        endsAt: input.startsAt + service.durationMinutes * 60_000,
        occupiesUntil: input.startsAt + occMin * 60_000,
        timezone: settings.timezone,
        createdByClerkUserId: actorId,
      },
      clock,
    )
    waivedIntent = updateSchedulingIntent(
      db,
      meta.tenantId,
      waivedIntent.id,
      {
        status: 'waived',
        appointmentId: confirmed.value.id,
        waivedReason: reason,
        waivedByClerkUserId: actorId,
        waivedAt: clock.nowMs(),
      },
      clock,
    )
  }

  writeOperationalAudit(
    db,
    {
      tenantId: meta.tenantId,
      actor: actorId,
      action: 'appointment.confirmed_without_signal',
      objectType: 'appointment',
      objectId: confirmed.value.id,
      detail: {
        waiveReason: reason,
        supersededChargeId,
        intentId: waivedIntent?.id ?? null,
      },
    },
    clock,
  )

  const result: ConfirmWithoutSignalResult = {
    appointmentId: confirmed.value.id,
    intent: waivedIntent,
    supersededChargeId,
    outbox: confirmed.outbox,
    idempotentReplay: false,
    detail: confirmed.value,
  }

  savePixChargeCommand(db, {
    tenantId: meta.tenantId,
    clientRequestId,
    command: 'confirm_without_signal',
    schedulingIntentId: waivedIntent?.id ?? null,
    chargeId: supersededChargeId,
    appointmentId: confirmed.value.id,
    result: {
      appointmentId: result.appointmentId,
      intent: waivedIntent,
      supersededChargeId,
      idempotentReplay: false,
      detail: confirmed.value,
    },
    createdAt: clock.nowMs(),
  })

  return result
}

export function getPixChargeDetailOp(
  db: ClinicDb,
  caller: ClinicCaller,
  chargeId: string,
  clock: Clock,
): { charge: PixChargeRow; intent: SchedulingIntentRow | null } {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const charge = getPixCharge(db, meta.tenantId, chargeId)
  if (!charge) {
    throw new NotFoundError('pix_charge_not_found', 'Cobrança não encontrada')
  }
  const intent = charge.schedulingIntentId
    ? getSchedulingIntent(db, meta.tenantId, charge.schedulingIntentId)
    : null
  return { charge, intent }
}

export function listConversationPixChargesOp(
  db: ClinicDb,
  caller: ClinicCaller,
  conversationId: string,
  clock: Clock,
): PixChargeRow[] {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  requireConversation(db, meta.tenantId, conversationId)
  return listPixChargesForConversation(db, meta.tenantId, conversationId)
}

// re-export helper used by tests
export { setIntentActiveCharge }
