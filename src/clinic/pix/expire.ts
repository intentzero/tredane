/**
 * Expiração e cancelamento de cobrança não paga (#40 / REQ-081 / AC-49).
 * Local + provedor com reconciliação; aviso tardio de pago → #39 (pago sem horário).
 */
import type { Clock } from '../../db/clock'
import type { PixProviderAdapter } from '../../pix'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import {
  findPixExceptionCommand,
  savePixExceptionCommand,
} from './exception-commands'
import {
  findPixLifecycleEvent,
  savePixLifecycleEvent,
} from './lifecycle-events'
import { getSchedulingIntent, updateSchedulingIntent } from './intents'
import {
  findPixChargeByProviderId,
  getPixCharge,
  listAwaitingChargesDue,
  markChargeCancelled,
  markChargeExpired,
  nextAwaitingChargeExpiry,
} from './charges'
import type {
  CancelUnpaidChargeInput,
  PixChargeRow,
  ProcessPixLifecycleInput,
  SchedulingIntentRow,
} from './types'

export type ExpireChargeResult = {
  charge: PixChargeRow
  intent: SchedulingIntentRow | null
  outbox: OutboxRow[]
  idempotentReplay: boolean
  providerSynced: boolean
}

export type CancelUnpaidChargeResult = ExpireChargeResult

export type ExpireDueChargesResult = {
  expired: ExpireChargeResult[]
  nextExpiryAt: number | null
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

function requireActor(caller: ClinicCaller, actorId: string): string {
  if (!caller.actorId && !actorId.trim()) {
    throw new ValidationError('actor_required', 'Actor obrigatório')
  }
  return actorId.trim() || caller.actorId!
}

async function cancelOnProviderIfPossible(
  adapter: PixProviderAdapter | undefined,
  providerChargeId: string | null,
): Promise<{ synced: boolean; providerStatus?: string }> {
  if (!adapter || !providerChargeId) return { synced: false }
  try {
    const got = await adapter.getCharge(providerChargeId)
    if (got.ok) {
      if (got.value.status === 'paid') {
        // Dinheiro rastreável — não expirar localmente como se não houvesse pagamento.
        return { synced: true, providerStatus: 'paid' }
      }
      if (got.value.status === 'expired' || got.value.status === 'cancelled') {
        return { synced: true, providerStatus: got.value.status }
      }
    }
    const cancelled = await adapter.cancelCharge(providerChargeId)
    if (cancelled.ok) {
      return { synced: true, providerStatus: cancelled.value.status }
    }
    // Já expirada no provedor: ok. Outros erros: local ainda marca.
    if (cancelled.code === 'invalid_state') {
      const again = await adapter.getCharge(providerChargeId)
      if (again.ok) {
        return { synced: true, providerStatus: again.value.status }
      }
    }
    return { synced: false }
  } catch {
    return { synced: false }
  }
}

function finalizeLocalExpiry(
  db: ClinicDb,
  tenantId: string,
  charge: PixChargeRow,
  clock: Clock,
  source: 'local_deadline' | 'provider_webhook' | 'attendant_cancel',
  actor: string,
): { charge: PixChargeRow; intent: SchedulingIntentRow | null; outbox: OutboxRow[] } {
  const isCancel = source === 'attendant_cancel'
  const next = isCancel
    ? markChargeCancelled(db, tenantId, charge.id, clock)
    : markChargeExpired(db, tenantId, charge.id, clock)

  let intent: SchedulingIntentRow | null = null
  if (charge.schedulingIntentId) {
    const existing = getSchedulingIntent(db, tenantId, charge.schedulingIntentId)
    if (existing && existing.status === 'awaiting_signal') {
      intent = updateSchedulingIntent(
        db,
        tenantId,
        existing.id,
        {
          status: isCancel ? 'cancelled' : 'expired',
          activeChargeId: charge.id,
        },
        clock,
      )
    } else {
      intent = existing
    }
  }

  const eventType = isCancel ? 'cobranca.cancelada' : 'cobranca.expirada'
  const outbox = [
    insertOutboxEvent(
      db,
      {
        tenantId,
        type: eventType,
        aggregateType: 'pix_charge',
        aggregateId: charge.id,
        idempotencyKey: `${eventType}:${charge.id}`,
        payload: {
          chargeId: charge.id,
          conversationId: charge.conversationId,
          contactId: charge.contactId,
          opportunityId: charge.opportunityId,
          source,
        },
      },
      clock,
    ),
  ]

  writeOperationalAudit(
    db,
    {
      tenantId,
      actor,
      action: isCancel ? 'pix.charge_cancelled' : 'pix.charge_expired',
      objectType: 'pix_charge',
      objectId: charge.id,
      detail: {
        source,
        amountCents: charge.amountCents,
        // sem dados bancários
      },
    },
    clock,
  )

  return { charge: next, intent, outbox }
}

/**
 * Expira cobranças locais vencidas; tenta cancelar no provedor (reconciliação).
 * Se o provedor já reporta pago, não marca expirada — dinheiro fica rastreável
 * para o caminho #39 (pago sem horário / pagamento após prazo).
 */
export async function expireDueChargesOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  deps?: { adapter?: PixProviderAdapter },
): Promise<ExpireDueChargesResult> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const due = listAwaitingChargesDue(db, meta.tenantId, clock.nowMs())
  const expired: ExpireChargeResult[] = []

  for (const charge of due) {
    const provider = await cancelOnProviderIfPossible(
      deps?.adapter,
      charge.providerChargeId,
    )
    if (provider.providerStatus === 'paid') {
      // Mantém awaiting localmente até webhook charge.paid (ou marca paid_without
      // via #39). Não apagar o rasto do dinheiro.
      continue
    }

    const result = db.transactionSync(() => {
      const current = getPixCharge(db, meta.tenantId, charge.id)
      if (!current || current.status !== 'awaiting_payment') {
        return null
      }
      return finalizeLocalExpiry(
        db,
        meta.tenantId,
        current,
        clock,
        'local_deadline',
        'system:pix_expiry',
      )
    })
    if (result) {
      expired.push({
        ...result,
        idempotentReplay: false,
        providerSynced: provider.synced,
      })
    }
  }

  return {
    expired,
    nextExpiryAt: nextAwaitingChargeExpiry(db, meta.tenantId, clock.nowMs()),
  }
}

/** Cancelamento humano de cobrança ainda não paga (REQ-081). */
export async function cancelUnpaidChargeOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: CancelUnpaidChargeInput,
  clock: Clock,
  deps?: { adapter?: PixProviderAdapter },
): Promise<CancelUnpaidChargeResult> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const clientRequestId = requireClientRequestId(input.clientRequestId)
  const actorId = requireActor(caller, input.actorClerkUserId)

  const existing = findPixExceptionCommand(db, meta.tenantId, clientRequestId)
  if (existing) {
    if (existing.command !== 'cancel_unpaid_charge') {
      throw new ConflictError(
        'client_request_id_reuse',
        'clientRequestId já usado noutra operação',
      )
    }
    const parsed = JSON.parse(existing.resultJson) as CancelUnpaidChargeResult
    return { ...parsed, outbox: [], idempotentReplay: true }
  }

  const charge = getPixCharge(db, meta.tenantId, input.chargeId)
  if (!charge) {
    throw new NotFoundError('pix_charge_not_found', 'Cobrança não encontrada')
  }
  if (charge.status !== 'awaiting_payment') {
    throw new ConflictError(
      'charge_not_awaiting',
      'Só é possível cancelar cobrança aguardando pagamento',
      { status: charge.status },
    )
  }

  const provider = await cancelOnProviderIfPossible(
    deps?.adapter,
    charge.providerChargeId,
  )
  if (provider.providerStatus === 'paid') {
    throw new ConflictError(
      'charge_already_paid',
      'Pagamento já registado no provedor — aguarde o processamento ou use o alerta',
    )
  }

  const result = db.transactionSync(() => {
    const current = getPixCharge(db, meta.tenantId, charge.id)!
    if (current.status !== 'awaiting_payment') {
      throw new ConflictError(
        'charge_not_awaiting',
        'Estado da cobrança mudou',
        { status: current.status },
      )
    }
    const finalized = finalizeLocalExpiry(
      db,
      meta.tenantId,
      current,
      clock,
      'attendant_cancel',
      actorId,
    )
    const payload: CancelUnpaidChargeResult = {
      ...finalized,
      idempotentReplay: false,
      providerSynced: provider.synced,
    }
    savePixExceptionCommand(db, {
      tenantId: meta.tenantId,
      clientRequestId,
      command: 'cancel_unpaid_charge',
      chargeId: charge.id,
      result: { ...payload, outbox: [] },
      createdAt: clock.nowMs(),
    })
    return payload
  })

  return result
}

/**
 * Webhook charge.expired / charge.cancelled do provedor.
 * Se local já estiver paga, regista rasto (ignored_late_paid_trace) sem apagar dinheiro.
 */
export function processPixLifecycleExpireCancelOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ProcessPixLifecycleInput,
  clock: Clock,
): ExpireChargeResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  if (
    input.eventType !== 'charge.expired' &&
    input.eventType !== 'charge.cancelled'
  ) {
    throw new ValidationError(
      'unsupported_lifecycle_event',
      'Esperado charge.expired ou charge.cancelled',
    )
  }

  const existing = findPixLifecycleEvent(db, meta.tenantId, input.eventId)
  if (existing?.chargeId) {
    const charge = getPixCharge(db, meta.tenantId, existing.chargeId)
    if (charge) {
      const intent = charge.schedulingIntentId
        ? getSchedulingIntent(db, meta.tenantId, charge.schedulingIntentId)
        : null
      return {
        charge,
        intent,
        outbox: [],
        idempotentReplay: true,
        providerSynced: true,
      }
    }
  }

  return db.transactionSync(() => {
    const again = findPixLifecycleEvent(db, meta.tenantId, input.eventId)
    if (again?.chargeId) {
      const c = getPixCharge(db, meta.tenantId, again.chargeId)!
      return {
        charge: c,
        intent: c.schedulingIntentId
          ? getSchedulingIntent(db, meta.tenantId, c.schedulingIntentId)
          : null,
        outbox: [],
        idempotentReplay: true,
        providerSynced: true,
      }
    }

    const charge = findPixChargeByProviderId(
      db,
      meta.tenantId,
      input.providerChargeId,
    )
    if (!charge) {
      throw new NotFoundError(
        'pix_charge_not_found',
        'Cobrança desconhecida nesta clínica',
      )
    }
    if (charge.accountId !== input.accountId) {
      throw new ValidationError(
        'account_mismatch',
        'Conta do webhook não corresponde à cobrança',
      )
    }

    // Já paga / em estorno: manter dinheiro rastreável (AC-49 aviso tardio).
    if (
      charge.status === 'paid' ||
      charge.status === 'refund_requested' ||
      charge.status === 'refunded' ||
      charge.status === 'refund_failed'
    ) {
      savePixLifecycleEvent(db, {
        tenantId: meta.tenantId,
        eventId: input.eventId,
        chargeId: charge.id,
        eventType: input.eventType,
        outcome: 'ignored_late_paid_trace',
        detail: { localStatus: charge.status },
        processedAt: clock.nowMs(),
      })
      return {
        charge,
        intent: charge.schedulingIntentId
          ? getSchedulingIntent(db, meta.tenantId, charge.schedulingIntentId)
          : null,
        outbox: [],
        idempotentReplay: false,
        providerSynced: true,
      }
    }

    if (charge.status === 'expired' || charge.status === 'cancelled') {
      savePixLifecycleEvent(db, {
        tenantId: meta.tenantId,
        eventId: input.eventId,
        chargeId: charge.id,
        eventType: input.eventType,
        outcome: charge.status === 'expired' ? 'expired' : 'cancelled',
        processedAt: clock.nowMs(),
      })
      return {
        charge,
        intent: charge.schedulingIntentId
          ? getSchedulingIntent(db, meta.tenantId, charge.schedulingIntentId)
          : null,
        outbox: [],
        idempotentReplay: true,
        providerSynced: true,
      }
    }

    const source =
      input.eventType === 'charge.cancelled'
        ? 'attendant_cancel'
        : 'provider_webhook'
    // provider_webhook → expired; attendant_cancel path via webhook cancelled → cancelled
    const finalized = finalizeLocalExpiry(
      db,
      meta.tenantId,
      charge,
      clock,
      input.eventType === 'charge.cancelled'
        ? 'attendant_cancel'
        : 'provider_webhook',
      'system:pix_webhook',
    )
    void source
    savePixLifecycleEvent(db, {
      tenantId: meta.tenantId,
      eventId: input.eventId,
      chargeId: charge.id,
      eventType: input.eventType,
      outcome:
        input.eventType === 'charge.cancelled' ? 'cancelled' : 'expired',
      processedAt: clock.nowMs(),
    })
    return {
      ...finalized,
      idempotentReplay: false,
      providerSynced: true,
    }
  })
}

export function peekNextPixExpiryOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
): number | null {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  return nextAwaitingChargeExpiry(db, meta.tenantId, clock.nowMs())
}
