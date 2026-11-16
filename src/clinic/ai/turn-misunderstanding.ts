/**
 * Deteção de incompreensão por turno (baseline 15/11/2026, S04/S06).
 * Complementa o streak do fallback DEC-107 (#801): repetição de oferta,
 * pergunta lateral ignorada, frustración da cliente, hora ofertada não aceite.
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import { isCatalogInfoAsk } from './booking-intent-text'
import { extractTimes } from './nlu/temporal'
import {
  CONSECUTIVE_MISUNDERSTANDING_THRESHOLD,
  readMisunderstandingStreak,
  resetMisunderstandingStreak,
  setMisunderstandingStreak,
} from './misunderstanding-streak'
import { replyMisunderstandingEscalation } from './human-handoff'
import type { OutboxRow } from '../outbox'

const SLOT_LIST_RE = /hor[aá]rios?\s+dispon[ií]veis/i
const FRUSTRATION_RE =
  /\b(n[aã]o\s+responde|vc\s+n[aã]o|voc[eê]\s+n[aã]o\s+responde|n[aã]o\s+entende|qual\s+o\s+valor|qnto\s+custa|mas\s+qual\s+o\s+valor)\b/i
const ASK_TIME_LOOP_RE = /qual\s+hor[aá]rio\s+(voc[eê]\s+)?prefere/i

export function normalizeOutboundForCompare(body: string): string {
  return body
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function outboundIsSlotListOffer(body: string): boolean {
  return SLOT_LIST_RE.test(body) || /\b\d{1,2}:\d{2}\b/.test(body)
}

export function inboundSignalsFrustration(text: string): boolean {
  return FRUSTRATION_RE.test(text.trim())
}

/** Pedido de preço sem cifra na resposta. */
export function outboundIgnoredPriceAsk(inbound: string, outbound: string): boolean {
  if (!isCatalogInfoAsk(inbound)) return false
  if (/\bR\$\s*\d|[\d.,]+\s*reais?\b/i.test(outbound)) return false
  if (/\ba equipe confirma o valor\b/i.test(outbound)) return false
  return true
}

export function outboundBodiesDuplicate(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false
  return normalizeOutboundForCompare(a) === normalizeOutboundForCompare(b)
}

export function outboundIsAskTimeLoop(body: string): boolean {
  return ASK_TIME_LOOP_RE.test(body)
}

export type TurnMisunderstandingReason =
  | 'duplicate_outbound'
  | 'ignored_price'
  | 'client_frustration'
  | 'ask_time_loop'

export function detectTurnMisunderstanding(input: {
  inboundBody: string
  outboundBody: string
  priorOutboundBody: string | null
}): TurnMisunderstandingReason | null {
  const { inboundBody, outboundBody, priorOutboundBody } = input
  const inboundHasClock =
    [...extractTimes(inboundBody)].length > 0 || /\b\d{1,2}:\d{2}\b/.test(inboundBody)
  if (
    inboundHasClock &&
    outboundIsAskTimeLoop(outboundBody) &&
    !/\bR\$\b/.test(outboundBody)
  ) {
    return 'ask_time_loop'
  }
  if (priorOutboundBody && outboundBodiesDuplicate(outboundBody, priorOutboundBody)) {
    // S04: segunda pergunta de preço com resposta válida + reoferta não é loop.
    if (
      isCatalogInfoAsk(inboundBody) &&
      /\bR\$\s*\d|[\d.,]+\s*reais?\b/i.test(outboundBody)
    ) {
      return null
    }
    return 'duplicate_outbound'
  }
  if (outboundIgnoredPriceAsk(inboundBody, outboundBody)) return 'ignored_price'
  if (inboundSignalsFrustration(inboundBody)) return 'client_frustration'
  return null
}

export function lastOutboundBody(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): string | null {
  const row = db.get<{ body: string }>(
    `SELECT m.body AS body
     FROM messages m
     WHERE m.tenant_id = ? AND m.conversation_id = ? AND m.direction = 'outbound'
     ORDER BY m.created_at DESC, m.rowid DESC
     LIMIT 1`,
    tenantId,
    conversationId,
  )
  return row?.body?.trim() ? row.body : null
}

export function bumpMisunderstandingStreak(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): number {
  const next = readMisunderstandingStreak(db, tenantId, conversationId) + 1
  setMisunderstandingStreak(db, tenantId, conversationId, next, clock)
  return next
}

export function maybeEscalateMisunderstanding(
  db: ClinicDb,
  tenantId: string,
  input: { conversationId: string; messageId: string; streak: number },
  clock: Clock,
): { escalate: boolean; outbox: OutboxRow[] } {
  if (input.streak < CONSECUTIVE_MISUNDERSTANDING_THRESHOLD) {
    return { escalate: false, outbox: [] }
  }
  resetMisunderstandingStreak(db, tenantId, input.conversationId, clock)
  const esc = replyMisunderstandingEscalation(db, tenantId, {
    conversationId: input.conversationId,
    clientRequestId: `ai-misunderstanding-esc:${input.messageId}`,
    messageId: input.messageId,
  }, clock)
  return { escalate: true, outbox: esc.outbox }
}