/**
 * Telemetria e anti-silêncio em toques WhatsApp (lista / botão M5 / proposta).
 * Staging 12/11/2026: list_reply processado sem outbound.
 */
import type { Clock } from '../../db/clock'
import { PROPOSAL_SEND_CLIENT_REQUEST_PREFIX } from '../constants'
import type { ClinicCaller } from '../envelopes'
import { sendOutboundMessageOp } from '../inbox/operations'
import type { OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { insertMessage } from '../inbox/messages'
import { AUTODRAFT_ACTOR_ID } from './autodraft'
import { notifyHumanHandoff, readAiReplyPause, resumeAiReply } from './human-handoff'
import { isConversationPaused } from './protection'

/** Texto curto quando o funil não produziu resposta após toque válido. */
export const CHOICE_CLICK_FALLBACK_TEXT = 'Recebi sua escolha, já confirmo para você.'

/** Oferta stale / quadro limpo sem reoferta. */
export const CHOICE_STALE_CLICK_FALLBACK_TEXT =
  'Essa opção não está mais disponível. Posso mostrar os horários de novo — qual prefere?'

export type InteractiveClickLogInput = {
  kind: 'choice' | 'proposal' | 'idle' | 'price_followup' | 'post_booking' | 'human_handoff'
  tenantId: string
  conversationId: string
  buttonId: string
  outcome?: string
  reason?: string
  outboxCount: number
  patientOutboxCount?: number
  fallbackSent?: boolean
  autoBookStatus?: string
  proposalId?: string | null
  /** Proposta criada com replyText vazio (envio já na outbox ou already_sent). */
  proposalWithoutReplyText?: boolean
  aiDurationMs?: number | null
  durationMs: number
  silentPrevented?: boolean
}

export function logInteractiveClickOutcome(input: InteractiveClickLogInput): void {
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'whatsapp.interactive_click',
      ...input,
    }),
  )
}

function silentGuardClientRequestId(providerEventKey: string | null | undefined, conversationId: string): string {
  const key = (providerEventKey ?? '').trim() || conversationId
  return `choice-silent-guard:${key}`
}

/** Só oferta efetivamente limpa ou TTL vencido usam cópia «não disponível». */
export function pickFallbackBody(outcome?: string, reason?: string): string {
  if (outcome === 'stale_cleared' || reason === 'expired') return CHOICE_STALE_CLICK_FALLBACK_TEXT
  return CHOICE_CLICK_FALLBACK_TEXT
}

/**
 * Envia fallback determinístico quando o toque não gerou outbound e a conversa
 * não está em pausa humana (DEC-083).
 */
export function sendChoiceClickSilentFallback(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    conversationId: string
    providerEventKey?: string | null
    outcome?: string
    reason?: string
  },
  clock: Clock,
): { sent: boolean; outbox: OutboxRow[]; body: string } {
  if (isConversationPaused(db, caller.tenantId, input.conversationId)) {
    return { sent: false, outbox: [], body: '' }
  }
  const clientRequestId = silentGuardClientRequestId(input.providerEventKey, input.conversationId)
  const existing = db.get<{ id: string }>(
    `SELECT id FROM outbound_messages WHERE tenant_id = ? AND client_request_id = ? LIMIT 1`,
    caller.tenantId,
    clientRequestId,
  )
  if (existing) return { sent: false, outbox: [], body: pickFallbackBody(input.outcome, input.reason) }

  const body = pickFallbackBody(input.outcome, input.reason)
  try {
    const sent = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId: input.conversationId,
        body,
        clientRequestId,
        authorClerkUserId: AUTODRAFT_ACTOR_ID,
        authorDisplayName: 'IA',
      },
      clock,
    )
    return { sent: true, outbox: sent.outbox, body }
  } catch {
    return { sent: false, outbox: [], body }
  }
}

const CHOICE_BOOKING_CLIENT_REQUEST_IDS = (key: string) =>
  [`choice:${key}`, `choice-stale:${key}`, `proposal.send:${key}`] as const

/**
 * Proposta enviada (`proposal.send:<proposalId>:v<n>`) depois do toque.
 * A chave da proposta é o id da proposta, não o `providerEventKey` do toque
 * (P8 / rsamp_fa7f138: «[Lista] terça 17/11 09:30» → «Proposta de horário»
 * contava como «sem confirmação» e escalava).
 */
function hasProposalSentAfterClick(
  db: ClinicDb,
  tenantId: string,
  providerEventKey: string | null | undefined,
  conversationId: string,
): boolean {
  const key = (providerEventKey ?? '').trim()
  if (!key) return false
  const click = db.get<{ created_at: number }>(
    `SELECT created_at FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound' AND external_message_id = ?
     LIMIT 1`,
    tenantId,
    conversationId,
    key,
  )
  if (!click) return false
  const row = db.get<{ id: string }>(
    `SELECT id FROM outbound_messages
     WHERE tenant_id = ? AND conversation_id = ? AND client_request_id LIKE ? AND created_at >= ?
     LIMIT 1`,
    tenantId,
    conversationId,
    `${PROPOSAL_SEND_CLIENT_REQUEST_PREFIX}%`,
    click.created_at,
  )
  return Boolean(row)
}

/** Confirmação / proposta do toque (não conta anti-silêncio genérico). */
export function hasChoiceClickBookingDelivery(
  db: ClinicDb,
  tenantId: string,
  providerEventKey: string | null | undefined,
  conversationId: string,
): boolean {
  const key = (providerEventKey ?? '').trim() || conversationId
  for (const clientRequestId of CHOICE_BOOKING_CLIENT_REQUEST_IDS(key)) {
    const row = db.get<{ id: string }>(
      `SELECT id FROM outbound_messages WHERE tenant_id = ? AND client_request_id = ? LIMIT 1`,
      tenantId,
      clientRequestId,
    )
    if (row) return true
  }
  return hasProposalSentAfterClick(db, tenantId, providerEventKey, conversationId)
}

/** Idempotência / retomada: o toque já gerou linha na outbox (inclui fallback)? */
export function hasChoiceClickOutbound(
  db: ClinicDb,
  tenantId: string,
  providerEventKey: string | null | undefined,
  conversationId: string,
): boolean {
  if (hasChoiceClickBookingDelivery(db, tenantId, providerEventKey, conversationId)) return true
  const row = db.get<{ id: string }>(
    `SELECT id FROM outbound_messages WHERE tenant_id = ? AND client_request_id = ? LIMIT 1`,
    tenantId,
    silentGuardClientRequestId(providerEventKey, conversationId),
  )
  return Boolean(row)
}

export function choiceClickHandoffEscalationMarkerId(
  providerEventKey: string | null | undefined,
  conversationId: string,
): string {
  const key = (providerEventKey ?? '').trim() || conversationId
  return `choice_click_handoff:${key}`
}

function hasChoiceClickHandoffEscalated(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  providerEventKey: string | null | undefined,
): boolean {
  const marker = choiceClickHandoffEscalationMarkerId(providerEventKey, conversationId)
  return Boolean(
    db.get<{ id: string }>(
      `SELECT id FROM messages
       WHERE tenant_id = ? AND conversation_id = ? AND direction = 'system' AND external_message_id = ?
       LIMIT 1`,
      tenantId,
      conversationId,
      marker,
    ),
  )
}

/**
 * Fila fallback sem confirmação/agendamento → handoff silencioso (DEC-083) + alerta.
 * Uma escalação por `providerEventKey`; sem nova mensagem à cliente.
 */
export function escalateChoiceClickDeliveryToTeam(
  db: ClinicDb,
  tenantId: string,
  input: { conversationId: string; providerEventKey?: string | null },
  clock: Clock,
): { escalated: boolean; already: boolean; outbox: OutboxRow[] } {
  const marker = choiceClickHandoffEscalationMarkerId(input.providerEventKey, input.conversationId)
  if (hasChoiceClickHandoffEscalated(db, tenantId, input.conversationId, input.providerEventKey)) {
    return { escalated: false, already: true, outbox: [] }
  }
  const handoff = notifyHumanHandoff(
    db,
    tenantId,
    {
      conversationId: input.conversationId,
      reason: 'human_only',
      clientRequestId: marker,
      silent: true,
    },
    clock,
  )
  if (handoff.already) {
    return { escalated: false, already: true, outbox: handoff.outbox }
  }
  insertMessage(
    db,
    {
      tenantId,
      conversationId: input.conversationId,
      direction: 'system',
      body: 'Escalação: toque em escolha sem confirmação após retentativa na fila.',
      externalMessageId: marker,
      deliveryState: 'received',
      authorClerkUserId: AUTODRAFT_ACTOR_ID,
      authorDisplayName: 'Sistema',
    },
    clock,
  )
  console.log(
    JSON.stringify({
      level: 'warn',
      event: 'whatsapp.choice_click_handoff',
      tenantId,
      conversationId: input.conversationId,
      providerEventKey: input.providerEventKey ?? null,
    }),
  )
  return { escalated: true, already: false, outbox: handoff.outbox }
}

/**
 * P8 (rsamp_fa7f138): a escalação por toque «sem confirmação» parte do princípio
 * de que a cliente ficou sem resposta. Se a cliente depois Confirmou e o
 * agendamento saiu, essa premissa caiu: devolve a conversa à IA e resolve o
 * alerta (sem «Comunicação pendente», sem «A equipe não conseguiu assumir»).
 *
 * Só desfaz pausas abertas por esta escalação (`human_only` + marcador
 * `choice_click_handoff:` depois da pausa). Pedido explícito da cliente
 * («Falar com a equipe», `customer_requested`) e Assumir ficam intactos.
 */
export function releaseChoiceClickEscalationAfterBooking(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): OutboxRow[] {
  const pause = readAiReplyPause(db, tenantId, conversationId)
  if (!pause || pause.reason !== 'human_only') return []
  const assumed = db.get<{ assignee: string | null }>(
    `SELECT assignee_clerk_user_id AS assignee FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  if (assumed?.assignee && !assumed.assignee.startsWith('system:')) return []
  const marker = db.get<{ id: string }>(
    `SELECT id FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'system'
       AND external_message_id LIKE 'choice_click_handoff:%' AND created_at >= ?
     LIMIT 1`,
    tenantId,
    conversationId,
    pause.at,
  )
  if (!marker) return []
  const outbox = resumeAiReply(db, tenantId, conversationId, clock, { source: 'manual_resume' })
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'whatsapp.choice_click_handoff_released',
      tenantId,
      conversationId,
      reason: 'booked',
    }),
  )
  return outbox
}

function patientWhatsappOutbox(rows: OutboxRow[]): OutboxRow[] {
  return rows.filter((o) => o.type === 'whatsapp.send')
}

export function ensureChoiceClickOutbound(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    conversationId: string
    providerEventKey?: string | null
    outcome?: string
    reason?: string
    outbox: OutboxRow[]
  },
  clock: Clock,
): { outbox: OutboxRow[]; fallbackSent: boolean; silentPrevented: boolean } {
  const patientRows = patientWhatsappOutbox(input.outbox)
  if (patientRows.length > 0) {
    return { outbox: input.outbox, fallbackSent: false, silentPrevented: false }
  }
  const fb = sendChoiceClickSilentFallback(db, caller, input, clock)
  if (fb.outbox.length === 0) {
    return { outbox: input.outbox, fallbackSent: false, silentPrevented: false }
  }
  return { outbox: fb.outbox, fallbackSent: fb.sent, silentPrevented: true }
}
