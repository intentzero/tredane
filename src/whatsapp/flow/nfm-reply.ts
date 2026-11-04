/**
 * Fecho do Flow → BookingFrame + proposta versionada (ADR-0016 §6).
 * Não marca compromisso: só o Confirmar (DEC-061).
 * `fallback_reason` (Finding 3): chat envia frase determinística (ex. sem_horario_semana).
 * Hub TR-306: `hub_action` remarcar/cancelar/meus — stubs sem proposta de marcação nova.
 */
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../../clinic/envelopes'
import { listServices } from '../../clinic/config/services'
import { getConversation } from '../../clinic/inbox/conversations'
import { sendOutboundMessageOp } from '../../clinic/inbox/operations'
import type { OutboxRow } from '../../clinic/outbox'
import type { ClinicDb } from '../../clinic/store'
import { tryAiAutoBook, type AutoBookOutcome } from '../../clinic/ai/autobook'
import { AUTODRAFT_ACTOR_ID, cancelAutoDraft } from '../../clinic/ai/autodraft'
import { createDeferredBookingFrame } from '../../clinic/ai/deferred-booking-frame'
import { notifyHumanHandoff } from '../../clinic/ai/human-handoff'
import {
  loadUpcomingAppointment,
  phraseAskDay,
} from '../../clinic/ai/reschedule'
import { getBookingFrame, saveBookingFrame } from '../../clinic/ai/schedule-session'
import { slotBindingFromChoice } from '../../clinic/ai/choice-offer'
import { readCatalogVersion } from '../../clinic/ai/turn-context'
import { sayAct } from '../../clinic/ai/dialogue-acts'
import { FLOW_COPY, type FlowHubStubAction } from './copy'
import { hubInformacoesBody, hubMeusBody } from './hub-opening'
import type { FlowChatFallbackReason } from './screens'

export type NfmReplyParams = {
  flowToken: string
  serviceId: string | null
  line: 'feminino' | 'masculino' | null
  variantIds: string[]
  slotId: string | null
  fallbackReason: FlowChatFallbackReason | null
  /** Stub hub — ausente no caminho Agendar. */
  hubAction: FlowHubStubAction | null
}

function asFallbackReason(raw: unknown): FlowChatFallbackReason | null {
  if (
    raw === 'no_slots' ||
    raw === 'too_many_variants' ||
    raw === 'no_bookable_services' ||
    raw === 'too_many_services'
  ) {
    return raw
  }
  return null
}

/** Extrai params do response_json do nfm_reply (string JSON da Meta). */
export function parseNfmResponseJson(raw: string): NfmReplyParams | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const token =
    typeof obj.flow_token === 'string'
      ? obj.flow_token
      : typeof obj.flowToken === 'string'
        ? obj.flowToken
        : null
  if (!token) return null

  const serviceId =
    typeof obj.service_id === 'string'
      ? obj.service_id
      : typeof obj.serviceId === 'string'
        ? obj.serviceId
        : null
  const lineRaw = obj.line
  const line = lineRaw === 'feminino' || lineRaw === 'masculino' ? lineRaw : null
  const variantsRaw = obj.variant_ids ?? obj.variantIds
  const variantIds = Array.isArray(variantsRaw)
    ? variantsRaw.filter((x): x is string => typeof x === 'string')
    : []
  const slotId =
    typeof obj.slot_id === 'string'
      ? obj.slot_id
      : typeof obj.slotId === 'string'
        ? obj.slotId
        : null
  const fallbackReason = asFallbackReason(
    obj.fallback_reason ?? obj.fallbackReason,
  )
  const hubRaw = obj.hub_action ?? obj.hubAction
  const hubAction =
    hubRaw === 'remarcar' ||
    hubRaw === 'cancelar' ||
    hubRaw === 'meus' ||
    hubRaw === 'informacoes' ||
    hubRaw === 'equipe'
      ? hubRaw
      : null

  return {
    flowToken: token,
    serviceId,
    line,
    variantIds,
    slotId,
    fallbackReason,
    hubAction,
  }
}

export type HandleFlowNfmReplyInput = {
  tenantId: string
  conversationId: string
  providerEventKey: string
  responseJson: string
  /** catalogVersion do token no envio — revalidação ADR-0015. */
  catalogVersion: string
  capability?: boolean
  /**
   * Envia o aviso de espera antes de montar a proposta (o cálculo pode demorar).
   * Se falhar, as linhas voltam no `outbox` final.
   */
  flushOutbound?: (rows: OutboxRow[]) => Promise<void>
}

export type HandleFlowNfmReplyResult = {
  handled: boolean
  outcome:
    | 'proposal_sent'
    | 'stale_no_proposal'
    | 'invalid_payload'
    | 'missing_fields'
    | 'idempotent_skip'
    | 'chat_fallback_sent'
    | 'hub_reschedule_started'
    | 'hub_handoff'
    | 'hub_meus_sent'
    | 'hub_info_sent'
  autoBook?: AutoBookOutcome
  outbox: OutboxRow[]
  reason?: string
}

/**
 * Stubs do hub TR-306 (Confirmado Paulo 04/11/2026).
 * Remarcar: DEC-129 (1) ou handoff DEC-083. Cancelar / Equipe: DEC-083.
 * Meus: frases Confirmadas (read-only). Informações: expediente + link config.
 */
function handleHubStub(
  db: ClinicDb,
  caller: ClinicCaller,
  input: HandleFlowNfmReplyInput,
  params: NfmReplyParams,
  clock: Clock,
): HandleFlowNfmReplyResult {
  const hubAction = params.hubAction
  if (!hubAction) {
    return { handled: true, outcome: 'invalid_payload', outbox: [], reason: 'no_hub_action' }
  }

  cancelAutoDraft(db, input.tenantId, input.conversationId)
  const conv = getConversation(db, input.tenantId, input.conversationId)

  if (hubAction === 'remarcar') {
    const apt = conv
      ? loadUpcomingAppointment(db, input.tenantId, conv.contactId, clock.nowMs())
      : null
    if (apt) {
      const catalogVersion =
        input.catalogVersion || readCatalogVersion(db, input.tenantId)
      const saved = saveBookingFrame(
        db,
        input.tenantId,
        input.conversationId,
        {
          serviceId: apt.serviceId,
          phase: 'remarcando',
          rescheduleAppointmentId: apt.id,
          date: null,
          time: null,
          period: null,
          pending: null,
          lastOffer: null,
          proposal: null,
          catalogVersion,
          source: 'flow',
          sourceMessageId: `flow-hub:${input.providerEventKey}`,
        },
        clock,
      )
      const outbox: OutboxRow[] = [...(saved.outbox ? [saved.outbox] : [])]
      outbox.push(
        ...sendDeterministicOutbound(
          db,
          caller,
          input.conversationId,
          `flow-hub-remarcar:${input.providerEventKey}`,
          phraseAskDay(),
          clock,
        ),
      )
      return {
        handled: true,
        outcome: 'hub_reschedule_started',
        outbox,
        reason: 'remarcar',
      }
    }
    const handoff = notifyHumanHandoff(
      db,
      input.tenantId,
      {
        conversationId: input.conversationId,
        reason: 'human_only',
        clientRequestId: `flow-hub-remarcar:${input.providerEventKey}`,
      },
      clock,
    )
    return {
      handled: true,
      outcome: 'hub_handoff',
      outbox: handoff.outbox,
      reason: 'remarcar',
    }
  }

  if (hubAction === 'meus') {
    const contactId = conv?.contactId
    const body = contactId
      ? hubMeusBody(db, input.tenantId, contactId, clock)
      : FLOW_COPY.hubMeusNone
    const outbox = sendDeterministicOutbound(
      db,
      caller,
      input.conversationId,
      `flow-hub-meus:${input.providerEventKey}`,
      body,
      clock,
    )
    return { handled: true, outcome: 'hub_meus_sent', outbox, reason: 'meus' }
  }

  if (hubAction === 'informacoes') {
    const body = hubInformacoesBody(db, input.tenantId, clock)
    const outbox = sendDeterministicOutbound(
      db,
      caller,
      input.conversationId,
      `flow-hub-info:${input.providerEventKey}`,
      body,
      clock,
    )
    return { handled: true, outcome: 'hub_info_sent', outbox, reason: 'informacoes' }
  }

  // cancelar | equipe → DEC-083 / DEC-091 (cancelar humano).
  const handoff = notifyHumanHandoff(
    db,
    input.tenantId,
    {
      conversationId: input.conversationId,
      reason: hubAction === 'equipe' ? 'customer_requested' : 'human_only',
      clientRequestId: `flow-hub-${hubAction}:${input.providerEventKey}`,
    },
    clock,
  )
  return {
    handled: true,
    outcome: 'hub_handoff',
    outbox: handoff.outbox,
    reason: hubAction,
  }
}

function fallbackBody(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  params: NfmReplyParams,
): string {
  const services = listServices(db, tenantId).filter((s) => s.active)
  const serviceName =
    (params.serviceId
      ? services.find((s) => s.id === params.serviceId)?.name?.trim()
      : null) || 'o serviço'
  if (params.fallbackReason === 'no_slots') {
    return sayAct(
      'sem_horario_semana',
      conversationId,
      { assunto: serviceName },
      `Para ${serviceName}, no momento não tenho horário livre. Quer que eu veja outra data?`,
    )
  }
  if (params.fallbackReason === 'too_many_variants') {
    return FLOW_COPY.openFailed
  }
  return FLOW_COPY.openFailed
}

function sendDeterministicOutbound(
  db: ClinicDb,
  caller: ClinicCaller,
  conversationId: string,
  clientRequestId: string,
  body: string,
  clock: Clock,
): OutboxRow[] {
  try {
    const sent = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId,
        body,
        clientRequestId,
        authorClerkUserId: AUTODRAFT_ACTOR_ID,
        authorDisplayName: 'IA',
      },
      clock,
    )
    return sent.outbox
  } catch {
    return []
  }
}

/**
 * Grava o quadro com provenance `flow` e monta a proposta (não marca).
 * Com `fallback_reason`, envia copy determinística e não propõe marcação.
 */
export async function handleFlowNfmReply(
  db: ClinicDb,
  caller: ClinicCaller,
  input: HandleFlowNfmReplyInput,
  clock: Clock,
): Promise<HandleFlowNfmReplyResult> {
  const params = parseNfmResponseJson(input.responseJson)
  if (!params) {
    return { handled: true, outcome: 'invalid_payload', outbox: [], reason: 'bad_json' }
  }

  if (params.hubAction) {
    return handleHubStub(db, caller, input, params, clock)
  }

  if (params.fallbackReason) {
    cancelAutoDraft(db, input.tenantId, input.conversationId)
    const body = fallbackBody(db, input.tenantId, input.conversationId, params)
    const outbox = sendDeterministicOutbound(
      db,
      caller,
      input.conversationId,
      `flow-fallback:${input.providerEventKey}`,
      body,
      clock,
    )
    return {
      handled: true,
      outcome: 'chat_fallback_sent',
      outbox,
      reason: params.fallbackReason,
    }
  }

  if (!params.serviceId || !params.slotId) {
    return { handled: true, outcome: 'missing_fields', outbox: [], reason: 'incomplete' }
  }

  const bound = slotBindingFromChoice(params.slotId, params.slotId)
  if (!bound) {
    return { handled: true, outcome: 'invalid_payload', outbox: [], reason: 'bad_slot_id' }
  }

  const services = listServices(db, input.tenantId).filter((s) => s.active)
  const service = services.find((s) => s.id === params.serviceId)
  if (!service) {
    return { handled: true, outcome: 'stale_no_proposal', outbox: [], reason: 'service_gone' }
  }

  const activeZones = service.zones.filter((z) => z.active)
  const zoneIds = new Set(activeZones.map((z) => z.id))
  let variantIds: string[] | null = null
  if (activeZones.length > 0) {
    const filtered = params.variantIds.filter((id) => zoneIds.has(id))
    if (filtered.length === 0) {
      return { handled: true, outcome: 'missing_fields', outbox: [], reason: 'variants_required' }
    }
    variantIds = filtered
  }

  cancelAutoDraft(db, input.tenantId, input.conversationId)

  const existing = getBookingFrame(db, input.tenantId, input.conversationId)
  if (
    existing?.serviceId === params.serviceId &&
    existing.time === bound.time &&
    existing.date === bound.date &&
    existing.provenance?.serviceId?.source === 'flow' &&
    (existing.proposal != null ||
      existing.phase === 'proposto' ||
      existing.phase === 'ofertado')
  ) {
    return { handled: true, outcome: 'idempotent_skip', outbox: [] }
  }

  const ackRows = sendDeterministicOutbound(
    db,
    caller,
    input.conversationId,
    `flow-ack:${input.providerEventKey}`,
    FLOW_COPY.preparingProposal,
    clock,
  )
  let ackPending = ackRows
  if (input.flushOutbound && ackRows.length > 0) {
    try {
      await input.flushOutbound(ackRows)
      ackPending = []
    } catch {
      ackPending = ackRows
    }
  }

  const catalogVersion = input.catalogVersion || readCatalogVersion(db, input.tenantId)
  const sourceMessageId = `flow:${input.providerEventKey}`
  const saved = saveBookingFrame(
    db,
    input.tenantId,
    input.conversationId,
    {
      serviceId: params.serviceId,
      line: params.line,
      variantIds,
      date: bound.date,
      time: bound.time,
      period: null,
      pending: null,
      lastOffer: null,
      phase: 'ofertado',
      catalogVersion,
      source: 'flow',
      sourceMessageId,
    },
    clock,
  )

  const outbox: OutboxRow[] = [...ackPending, ...(saved.outbox ? [saved.outbox] : [])]

  const lastInbound = db.get<{ id: string }>(
    `SELECT id FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound'
     ORDER BY created_at DESC LIMIT 1`,
    input.tenantId,
    input.conversationId,
  )
  const confirmationMessageId = lastInbound?.id ?? sourceMessageId

  const autoBook = await tryAiAutoBook(db, caller, clock, {
    conversationId: input.conversationId,
    capability: input.capability !== false,
    turnTextOverride: service.name.trim() || 'quero agendar',
    confirmationMessageIdOverride: confirmationMessageId,
    boundSlot: { date: bound.date, time: bound.time },
  })

  outbox.push(...autoBook.outbox)
  if (autoBook.proposalId && !autoBook.replyText?.trim()) {
    autoBook.deferredFrame?.discard()
    return {
      handled: true,
      outcome: 'proposal_sent',
      autoBook,
      outbox,
    }
  }
  const body = autoBook.replyText?.trim()
  if (body) {
    const deferred = autoBook.deferredFrame ?? createDeferredBookingFrame()
    try {
      const sent = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: input.conversationId,
          body,
          clientRequestId: `flow-nfm:${input.providerEventKey}`,
          authorClerkUserId: AUTODRAFT_ACTOR_ID,
          authorDisplayName: 'IA',
          ...(deferred.hasWork ? { afterPersist: deferred.toAfterPersist(clock) } : {}),
        },
        clock,
      )
      deferred.discard()
      outbox.push(...sent.outbox)
    } catch {
      if (deferred.hasWork) {
        outbox.push(...deferred.flushNow(db, caller.tenantId, input.conversationId, clock))
      }
    }
  } else if (autoBook.deferredFrame?.hasWork) {
    outbox.push(
      ...autoBook.deferredFrame.flushNow(db, caller.tenantId, input.conversationId, clock),
    )
  }

  return {
    handled: true,
    outcome: autoBook.proposalId ? 'proposal_sent' : 'stale_no_proposal',
    autoBook,
    outbox,
    reason: autoBook.proposalId ? undefined : 'no_proposal',
  }
}
