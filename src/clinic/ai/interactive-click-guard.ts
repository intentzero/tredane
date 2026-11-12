/**
 * Telemetria e anti-silêncio em toques WhatsApp (lista / botão M5 / proposta).
 * Staging 12/11/2026: list_reply processado sem outbound.
 */
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { sendOutboundMessageOp } from '../inbox/operations'
import type { OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { AUTODRAFT_ACTOR_ID } from './autodraft'
import { isConversationPaused } from './protection'

/** Texto curto quando o funil não produziu resposta após toque válido. */
export const CHOICE_CLICK_FALLBACK_TEXT =
  'Recebi sua escolha. Estou preparando o próximo passo — se não aparecer em instantes, me diga o horário de novo.'

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

function pickFallbackBody(outcome?: string, reason?: string): string {
  if (outcome === 'stale_cleared' || reason) return CHOICE_STALE_CLICK_FALLBACK_TEXT
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
  if (input.outbox.length > 0) {
    return { outbox: input.outbox, fallbackSent: false, silentPrevented: false }
  }
  const fb = sendChoiceClickSilentFallback(db, caller, input, clock)
  if (fb.outbox.length === 0) {
    return { outbox: input.outbox, fallbackSent: false, silentPrevented: false }
  }
  return { outbox: fb.outbox, fallbackSent: fb.sent, silentPrevented: true }
}
