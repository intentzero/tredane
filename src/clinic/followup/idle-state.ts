/**
 * DEC-087 — estado e reagendamento de idle (sem envio WhatsApp).
 * Separado de `idle.ts` para evitar ciclo com `inbox/operations`.
 */
import type { Clock } from '../../db/clock'
import { assertClinicSchemaReady } from '../migrations'
import { findOpenOpportunityForConversation } from '../pipeline'
import type { ClinicDb } from '../store'

/** Confirmado: 30 minutos sem progresso útil. */
export const IDLE_PROMPT_AFTER_MS = 30 * 60_000
/** Confirmado (DEC-087): mais 30 minutos sem resposta à pergunta de idle. */
export const IDLE_CLOSE_AFTER_MS = 30 * 60_000

export type IdlePhase = 'prompt' | 'close'

/** Última mensagem inbound ou outbound (system não conta — DEC-087). */
export function lastUsefulMessageAt(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): number | null {
  const row = db.get<{ at: number | null }>(
    `SELECT MAX(created_at) AS at FROM messages
     WHERE tenant_id = ? AND conversation_id = ?
       AND direction IN ('inbound', 'outbound')`,
    tenantId,
    conversationId,
  )
  return row?.at ?? null
}

/** Humano activo = Assumir / DEC-083 (pausa da IA). */
export function conversationHasActiveHuman(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): boolean {
  const row = db.get<{ paused: number | null }>(
    `SELECT ai_reply_paused_at AS paused FROM conversations
     WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  return row?.paused != null
}

export function clearConversationIdle(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  updatedAt: number,
): void {
  db.run(
    `UPDATE conversations
     SET idle_due_at = NULL, idle_phase = NULL, idle_prompt_sent_at = NULL, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    updatedAt,
    tenantId,
    conversationId,
  )
}

export function setConversationIdle(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  input: {
    phase: IdlePhase
    dueAt: number
    promptSentAt: number | null
    updatedAt: number
  },
): void {
  db.run(
    `UPDATE conversations
     SET idle_due_at = ?, idle_phase = ?, idle_prompt_sent_at = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    input.dueAt,
    input.phase,
    input.promptSentAt,
    input.updatedAt,
    tenantId,
    conversationId,
  )
}

/**
 * Após inbound/outbound útil: reinicia o prazo de prompt (+30 min) se elegível.
 */
export function rescheduleConversationIdle(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
  opts?: { progressAt?: number },
): number | null {
  assertClinicSchemaReady(db)
  const now = clock.nowMs()
  const opp = findOpenOpportunityForConversation(db, tenantId, conversationId)
  if (!opp || conversationHasActiveHuman(db, tenantId, conversationId)) {
    clearConversationIdle(db, tenantId, conversationId, now)
    return null
  }
  const progressAt =
    opts?.progressAt ?? lastUsefulMessageAt(db, tenantId, conversationId) ?? now
  const dueAt = progressAt + IDLE_PROMPT_AFTER_MS
  setConversationIdle(db, tenantId, conversationId, {
    phase: 'prompt',
    dueAt,
    promptSentAt: null,
    updatedAt: now,
  })
  return dueAt
}

export function nextIdleDueAt(db: ClinicDb, tenantId: string): number | null {
  const row = db.get<{ t: number | null }>(
    `SELECT MIN(idle_due_at) AS t FROM conversations
     WHERE tenant_id = ? AND idle_due_at IS NOT NULL`,
    tenantId,
  )
  return row?.t ?? null
}
