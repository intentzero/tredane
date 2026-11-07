/**
 * Fecho do Flow → BookingFrame + proposta versionada (ADR-0016 §6).
 * Não marca compromisso: só o Confirmar (DEC-061).
 * `fallback_reason` (Finding 3): chat envia frase determinística (ex. sem_horario_semana).
 * Hub TR-306: `hub_action` remarcar/cancelar/meus — stubs sem proposta de marcação nova.
 *
 * Fase `ack` vs `proposal` (fumo staging 04/11/2026): o Durable Object é
 * single-thread; se `tryAiAutoBook` correr antes do claim Meta do C16, o ack
 * fica na fila até a proposta acabar e a cliente sente vácuo. O consumer
 * envia o ack (e typing) em linha *fora* do DO entre as duas fases.
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
import {
  applyBookingUpdate,
  isStaleFlowVersusChat,
} from '../../clinic/ai/apply-booking-update'
import { getBookingFrame, saveBookingFrame } from '../../clinic/ai/schedule-session'
import { slotBindingFromChoice } from '../../clinic/ai/choice-offer'
import { readCatalogVersion } from '../../clinic/ai/turn-context'
import { sayAct } from '../../clinic/ai/dialogue-acts'
import { enqueueTypingIndicatorForLatestInbound } from '../../clinic/ai/typing-indicator'
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
    raw === 'too_many_services' ||
    raw === 'catalog_changed'
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

/**
 * `ack` — typing + C16 + quadro; devolve cedo para o consumer enviar à Meta.
 * `proposal` — monta/envia proposta (ou recuperação); assume ack já feito.
 * `all` — as duas (testes / caminhos sem consumer biphasic).
 */
export type FlowNfmPhase = 'ack' | 'proposal' | 'all'

export type HandleFlowNfmReplyInput = {
  tenantId: string
  conversationId: string
  providerEventKey: string
  responseJson: string
  /** catalogVersion do token no envio — revalidação ADR-0015. */
  catalogVersion: string
  capability?: boolean
  phase?: FlowNfmPhase
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
    | 'ack_sent'
    | 'closed_without_booking'
  autoBook?: AutoBookOutcome
  outbox: OutboxRow[]
  reason?: string
  /** Consumer: ainda falta a fase proposal (após Meta inline do ack). */
  needsProposal?: boolean
}

/**
 * C16 / proposta só com fecho Agendar bookable: service + slot civil, sem
 * stub hub e sem fallback_reason. Hub / incompleto / vazio → nunca C16.
 */
export function isBookableAgendarNfm(params: NfmReplyParams): boolean {
  if (params.hubAction || params.fallbackReason) return false
  if (!params.serviceId || !params.slotId) return false
  return Boolean(slotBindingFromChoice(params.slotId, params.slotId))
}

function flowAckClientRequestId(providerEventKey: string): string {
  return `flow-ack:${providerEventKey}`
}

function hasFlowAckForEvent(
  db: ClinicDb,
  tenantId: string,
  providerEventKey: string,
): boolean {
  return Boolean(
    db.get<{ id: string }>(
      `SELECT id FROM outbound_messages
       WHERE tenant_id = ? AND client_request_id = ?
       LIMIT 1`,
      tenantId,
      flowAckClientRequestId(providerEventKey),
    ),
  )
}

type PreparedAgendar = {
  params: NfmReplyParams
  bound: { date: string; time: string }
  serviceName: string
  variantIds: string[] | null
}

/**
 * C16b só quando C16 já prometeu proposta: ack deste evento, ou quadro
 * mid-flight (ofertado flow sem proposal) — não em fecho incompleto/hub.
 */
function proposalPromisedForPrepared(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  providerEventKey: string,
  prepared: PreparedAgendar,
): boolean {
  if (hasFlowAckForEvent(db, tenantId, providerEventKey)) return true
  const existing = getBookingFrame(db, tenantId, conversationId)
  return (
    existing?.serviceId === prepared.params.serviceId &&
    existing.date === prepared.bound.date &&
    existing.time === prepared.bound.time &&
    existing.provenance?.serviceId?.source === 'flow' &&
    existing.proposal == null &&
    existing.phase === 'ofertado'
  )
}

/** Fecho sem marcação bookable: frase curta, nunca C16/C16b. */
function closedWithoutBooking(
  db: ClinicDb,
  caller: ClinicCaller,
  input: HandleFlowNfmReplyInput,
  clock: Clock,
  reason: string,
): HandleFlowNfmReplyResult {
  if (input.phase === 'proposal') {
    // Sem C16 neste evento → sem C16b (fumo 04/11 ~21:11).
    return {
      handled: true,
      outcome: 'closed_without_booking',
      outbox: [],
      reason,
      needsProposal: false,
    }
  }
  const outbox = sendDeterministicOutbound(
    db,
    caller,
    input.conversationId,
    `flow-closed:${input.providerEventKey}`,
    FLOW_COPY.flowClosedContinue,
    clock,
  )
  return {
    handled: true,
    outcome: 'closed_without_booking',
    outbox,
    reason,
    needsProposal: false,
  }
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
 * Skip C16 só mid-flight / redelivery — nunca «para sempre» na conversa (F1 #556).
 * - Mesmo `providerEventKey` já tem `flow-ack:…` (reentrega do webhook).
 * - Quadro in-flight: ofertado flow, mesmo serviço/data/hora, ainda sem proposal.
 * Um Flow novo (outro horário / ciclo) volta a enviar C16.
 */
function shouldSkipFlowAck(
  db: ClinicDb,
  tenantId: string,
  providerEventKey: string,
  existing: ReturnType<typeof getBookingFrame>,
  prepared: PreparedAgendar,
): boolean {
  if (hasFlowAckForEvent(db, tenantId, providerEventKey)) return true

  if (
    existing?.serviceId === prepared.params.serviceId &&
    existing.date === prepared.bound.date &&
    existing.time === prepared.bound.time &&
    existing.provenance?.serviceId?.source === 'flow' &&
    existing.proposal == null &&
    existing.phase === 'ofertado'
  ) {
    return true
  }
  return false
}

function prepareAgendarFields(
  db: ClinicDb,
  tenantId: string,
  params: NfmReplyParams,
):
  | { ok: true; prepared: PreparedAgendar }
  | { ok: false; result: HandleFlowNfmReplyResult } {
  if (!params.serviceId || !params.slotId) {
    return {
      ok: false,
      result: { handled: true, outcome: 'missing_fields', outbox: [], reason: 'incomplete' },
    }
  }
  const bound = slotBindingFromChoice(params.slotId, params.slotId)
  if (!bound) {
    return {
      ok: false,
      result: { handled: true, outcome: 'invalid_payload', outbox: [], reason: 'bad_slot_id' },
    }
  }
  const services = listServices(db, tenantId).filter((s) => s.active)
  const service = services.find((s) => s.id === params.serviceId)
  if (!service) {
    return {
      ok: false,
      result: {
        handled: true,
        outcome: 'stale_no_proposal',
        outbox: [],
        reason: 'service_gone',
      },
    }
  }
  const activeZones = service.zones.filter((z) => z.active)
  const zoneIds = new Set(activeZones.map((z) => z.id))
  let variantIds: string[] | null = null
  if (activeZones.length > 0) {
    const filtered = params.variantIds.filter((id) => zoneIds.has(id))
    if (filtered.length === 0) {
      return {
        ok: false,
        result: {
          handled: true,
          outcome: 'missing_fields',
          outbox: [],
          reason: 'variants_required',
        },
      }
    }
    variantIds = filtered
  }
  return {
    ok: true,
    prepared: {
      params,
      bound,
      serviceName: service.name.trim() || 'quero agendar',
      variantIds,
    },
  }
}

async function flushRows(
  input: HandleFlowNfmReplyInput,
  rows: OutboxRow[],
): Promise<OutboxRow[]> {
  if (!input.flushOutbound || rows.length === 0) return rows
  try {
    await input.flushOutbound(rows)
    return []
  } catch {
    return rows
  }
}

async function buildAndSendProposal(
  db: ClinicDb,
  caller: ClinicCaller,
  input: HandleFlowNfmReplyInput,
  prepared: PreparedAgendar,
  clock: Clock,
  priorOutbox: OutboxRow[],
): Promise<HandleFlowNfmReplyResult> {
  const outbox: OutboxRow[] = [...priorOutbox]
  const lastInbound = db.get<{ id: string }>(
    `SELECT id FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound'
     ORDER BY created_at DESC LIMIT 1`,
    input.tenantId,
    input.conversationId,
  )
  const sourceMessageId = `flow:${input.providerEventKey}`
  const confirmationMessageId = lastInbound?.id ?? sourceMessageId

  let autoBook: AutoBookOutcome
  try {
    autoBook = await tryAiAutoBook(db, caller, clock, {
      conversationId: input.conversationId,
      capability: input.capability !== false,
      turnTextOverride: prepared.serviceName,
      confirmationMessageIdOverride: confirmationMessageId,
      boundSlot: { date: prepared.bound.date, time: prepared.bound.time },
    })
  } catch (err) {
    if (
      proposalPromisedForPrepared(
        db,
        input.tenantId,
        input.conversationId,
        input.providerEventKey,
        prepared,
      )
    ) {
      outbox.push(
        ...sendDeterministicOutbound(
          db,
          caller,
          input.conversationId,
          `flow-proposal-fail:${input.providerEventKey}`,
          FLOW_COPY.proposalBuildFailed,
          clock,
        ),
      )
    }
    return {
      handled: true,
      outcome: 'stale_no_proposal',
      outbox,
      reason: err instanceof Error ? err.message.slice(0, 120) : 'autobook_throw',
      needsProposal: false,
    }
  }

  outbox.push(...autoBook.outbox)
  if (autoBook.proposalId && !autoBook.replyText?.trim()) {
    autoBook.deferredFrame?.discard()
    return {
      handled: true,
      outcome: 'proposal_sent',
      autoBook,
      outbox,
      needsProposal: false,
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
      if (
        proposalPromisedForPrepared(
          db,
          input.tenantId,
          input.conversationId,
          input.providerEventKey,
          prepared,
        )
      ) {
        outbox.push(
          ...sendDeterministicOutbound(
            db,
            caller,
            input.conversationId,
            `flow-proposal-fail:${input.providerEventKey}`,
            FLOW_COPY.proposalBuildFailed,
            clock,
          ),
        )
      }
      return {
        handled: true,
        outcome: 'stale_no_proposal',
        autoBook,
        outbox,
        reason: 'send_failed',
        needsProposal: false,
      }
    }
  } else if (autoBook.deferredFrame?.hasWork) {
    outbox.push(
      ...autoBook.deferredFrame.flushNow(db, caller.tenantId, input.conversationId, clock),
    )
  }

  if (
    !autoBook.proposalId &&
    !body &&
    proposalPromisedForPrepared(
      db,
      input.tenantId,
      input.conversationId,
      input.providerEventKey,
      prepared,
    )
  ) {
    // Ack já prometeu proposta — nunca silêncio (fumo staging 04/11/2026).
    outbox.push(
      ...sendDeterministicOutbound(
        db,
        caller,
        input.conversationId,
        `flow-proposal-fail:${input.providerEventKey}`,
        FLOW_COPY.proposalBuildFailed,
        clock,
      ),
    )
  }

  return {
    handled: true,
    outcome: autoBook.proposalId ? 'proposal_sent' : 'stale_no_proposal',
    autoBook,
    outbox,
    reason: autoBook.proposalId ? undefined : 'no_proposal',
    needsProposal: false,
  }
}

/**
 * Grava o quadro com provenance `flow` e monta a proposta (não marca).
 * Com `fallback_reason`, envia copy determinística e não propõe marcação.
 * Fase `ack` devolve cedo após C16 para o Meta send não esperar o autobook.
 */
export async function handleFlowNfmReply(
  db: ClinicDb,
  caller: ClinicCaller,
  input: HandleFlowNfmReplyInput,
  clock: Clock,
): Promise<HandleFlowNfmReplyResult> {
  const phase: FlowNfmPhase = input.phase ?? 'all'
  const params = parseNfmResponseJson(input.responseJson)
  if (!params) {
    return { handled: true, outcome: 'invalid_payload', outbox: [], reason: 'bad_json' }
  }

  if (params.hubAction) {
    if (phase === 'proposal') {
      return { handled: true, outcome: 'idempotent_skip', outbox: [], reason: 'hub_done' }
    }
    return handleHubStub(db, caller, input, params, clock)
  }

  if (params.fallbackReason) {
    if (phase === 'proposal') {
      return { handled: true, outcome: 'idempotent_skip', outbox: [], reason: 'fallback_done' }
    }
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
      needsProposal: false,
    }
  }

  // Sem service+slot bookable: nunca C16 («já preparo a proposta») nem C16b.
  if (!isBookableAgendarNfm(params)) {
    cancelAutoDraft(db, input.tenantId, input.conversationId)
    return closedWithoutBooking(
      db,
      caller,
      { ...input, phase },
      clock,
      !params.serviceId && !params.slotId ? 'empty_nfm' : 'incomplete',
    )
  }

  const preparedResult = prepareAgendarFields(db, input.tenantId, params)
  if (!preparedResult.ok) {
    cancelAutoDraft(db, input.tenantId, input.conversationId)
    const reason = preparedResult.result.reason ?? 'incomplete'
    // Só C16b se C16 deste evento já prometeu proposta.
    if (
      phase === 'proposal' &&
      hasFlowAckForEvent(db, input.tenantId, input.providerEventKey)
    ) {
      const recovery = sendDeterministicOutbound(
        db,
        caller,
        input.conversationId,
        `flow-proposal-fail:${input.providerEventKey}`,
        FLOW_COPY.proposalBuildFailed,
        clock,
      )
      return {
        handled: true,
        outcome: preparedResult.result.outcome,
        outbox: recovery,
        reason: `${reason}_after_ack`,
        needsProposal: false,
      }
    }
    if (
      reason === 'incomplete' ||
      reason === 'bad_slot_id' ||
      reason === 'variants_required' ||
      reason === 'service_gone'
    ) {
      return closedWithoutBooking(db, caller, { ...input, phase }, clock, reason)
    }
    return { ...preparedResult.result, needsProposal: false }
  }
  const { prepared } = preparedResult

  const existing = getBookingFrame(db, input.tenantId, input.conversationId)
  const preparedVariantKey = [...(prepared.variantIds ?? [])].sort().join('\0')
  const existingVariantKey = [...(existing?.variantIds ?? [])].sort().join('\0')
  // Só skip total quando a proposta versionada já existe (DEC-061) e o
  // snapshot Flow (serviço/data/hora/variantes) coincide — ADR-0016 §6.
  // `phase === ofertado` sem proposal = ack a meio / falha — não engolir o 2.º nfm.
  if (
    existing?.serviceId === prepared.params.serviceId &&
    existing.time === prepared.bound.time &&
    existing.date === prepared.bound.date &&
    existingVariantKey === preparedVariantKey &&
    existing.provenance?.serviceId?.source === 'flow' &&
    existing.proposal != null
  ) {
    return { handled: true, outcome: 'idempotent_skip', outbox: [], needsProposal: false }
  }

  // D6: Flow stale vs correção recente no chat — não sobrescrever o quadro.
  if (
    isStaleFlowVersusChat(existing, {
      serviceId: prepared.params.serviceId!,
      variantIds: prepared.variantIds,
      date: prepared.bound.date,
      time: prepared.bound.time,
    })
  ) {
    cancelAutoDraft(db, input.tenantId, input.conversationId)
    return {
      handled: true,
      outcome: 'stale_no_proposal',
      outbox: [],
      reason: 'chat_corrected',
      needsProposal: false,
    }
  }

  if (phase === 'proposal') {
    cancelAutoDraft(db, input.tenantId, input.conversationId)
    return buildAndSendProposal(db, caller, input, prepared, clock, [])
  }

  // ——— fase ack (ou all) ———
  cancelAutoDraft(db, input.tenantId, input.conversationId)

  const earlyRows: OutboxRow[] = []
  const typing = enqueueTypingIndicatorForLatestInbound(
    db,
    input.tenantId,
    input.conversationId,
    clock,
  )
  if (typing) earlyRows.push(typing)

  const skipDuplicateAck = shouldSkipFlowAck(
    db,
    input.tenantId,
    input.providerEventKey,
    existing,
    prepared,
  )
  if (!skipDuplicateAck) {
    earlyRows.push(
      ...sendDeterministicOutbound(
        db,
        caller,
        input.conversationId,
        flowAckClientRequestId(input.providerEventKey),
        FLOW_COPY.preparingProposal,
        clock,
      ),
    )
  }

  let ackPending = await flushRows(input, earlyRows)

  const catalogVersion = input.catalogVersion || readCatalogVersion(db, input.tenantId)
  const sourceMessageId = `flow:${input.providerEventKey}`
  // PR-D: commit via actualizador (intent commit_flow); provenance `flow`.
  const flowUpdate = applyBookingUpdate({
    frame: existing,
    intent: {
      type: 'commit_flow',
      serviceId: prepared.params.serviceId!,
      line: prepared.params.line,
      variantIds: prepared.variantIds,
      date: prepared.bound.date,
      time: prepared.bound.time,
    },
    evidence: { source: 'flow', sourceMessageId },
    serviceId: prepared.params.serviceId,
    catalogVersion,
  })
  const saved = saveBookingFrame(
    db,
    input.tenantId,
    input.conversationId,
    {
      ...flowUpdate.patch,
      catalogVersion,
      source: 'flow',
      sourceMessageId,
    },
    clock,
  )
  if (saved.outbox) ackPending = [...ackPending, saved.outbox]

  if (phase === 'ack') {
    return {
      handled: true,
      outcome: 'ack_sent',
      outbox: ackPending,
      needsProposal: true,
      reason: skipDuplicateAck ? 'ack_already_sent' : undefined,
    }
  }

  return buildAndSendProposal(db, caller, input, prepared, clock, ackPending)
}
