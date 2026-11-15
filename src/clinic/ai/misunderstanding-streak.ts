/**
 * Após N incompreensões consecutivas, oferece atendente humano (baseline 15/11/2026;
 * fundador aprovou «Ok para a regra», 15/11/2026 17:46 BRT).
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'

/** Limite aprovado pelo fundador — ativo por defeito. */
export const CONSECUTIVE_MISUNDERSTANDING_THRESHOLD = 2

export const MISUNDERSTANDING_ESCALATION_TEXT =
  'Percebi que ainda não ficou claro por aqui. Deixei seu pedido para a equipe e, se quiser, sigo te ajudando com horários.'

const MISUNDERSTANDING_BODY_RES = [
  /n[aã]o\s+consegui\s+entender\s+bem/i,
  /n[aã]o\s+entendi\s+bem/i,
  /prefere\s+falar\s+com\s+a\s+equipe/i,
  /n[aã]o\s+entendi\s+bem\s+esse\s+pedido/i,
]

export function isMisunderstandingOutboundBody(body: string): boolean {
  const t = body.trim()
  if (!t) return false
  return MISUNDERSTANDING_BODY_RES.some((re) => re.test(t))
}

export function readMisunderstandingStreak(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): number {
  const row = db.get<{ n: number | null }>(
    `SELECT ai_misunderstanding_streak AS n FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  return row?.n ?? 0
}

export function resetMisunderstandingStreak(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): void {
  db.run(
    `UPDATE conversations SET ai_misunderstanding_streak = 0, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    clock.nowMs(),
    tenantId,
    conversationId,
  )
}

export function recordMisunderstandingOutbound(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  body: string,
  clock: Clock,
): { streak: number; thresholdReached: boolean } {
  if (!isMisunderstandingOutboundBody(body)) {
    resetMisunderstandingStreak(db, tenantId, conversationId, clock)
    return { streak: 0, thresholdReached: false }
  }
  const prev = readMisunderstandingStreak(db, tenantId, conversationId)
  const streak = prev + 1
  db.run(
    `UPDATE conversations SET ai_misunderstanding_streak = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    streak,
    clock.nowMs(),
    tenantId,
    conversationId,
  )
  return {
    streak,
    thresholdReached: streak >= CONSECUTIVE_MISUNDERSTANDING_THRESHOLD,
  }
}

export function shouldEscalateAfterMisunderstanding(streak: number): boolean {
  return streak >= CONSECUTIVE_MISUNDERSTANDING_THRESHOLD
}

export function setMisunderstandingStreak(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  streak: number,
  clock: Clock,
): void {
  db.run(
    `UPDATE conversations SET ai_misunderstanding_streak = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    streak,
    clock.nowMs(),
    tenantId,
    conversationId,
  )
}