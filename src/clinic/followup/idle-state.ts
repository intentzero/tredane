/**
 * DEC-087 / DEC-208 — estado e reagendamento de idle (sem envio WhatsApp).
 * Separado de `idle.ts` para evitar ciclo com `inbox/operations`.
 */
import type { Clock } from '../../db/clock'
import { assertClinicSchemaReady } from '../migrations'
import { findOpenOpportunityForConversation } from '../pipeline'
import type { ClinicDb } from '../store'

/**
 * Confirmado (DEC-208, Paulo 19/11/2026): 30 minutos sem actividade
 * (última inbound ou outbound) → encerrar. Unifica o antigo 15+15 (DEC-087).
 */
export const IDLE_TIMEOUT_MS = 30 * 60_000

/** @deprecated Alias de IDLE_TIMEOUT_MS (DEC-208). */
export const IDLE_PROMPT_AFTER_MS = IDLE_TIMEOUT_MS

/**
 * @deprecated Segundo prazo removido pela DEC-208 (já não há pergunta intermédia).
 * Mantido a 0 para testes/importações legadas.
 */
export const IDLE_CLOSE_AFTER_MS = 0

/**
 * Fase gravada no SQLite. Desde DEC-208 só se agenda `close` (fecho directo);
 * `prompt` pode existir em linhas antigas e o sweep trata-as como fecho.
 */
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

/** Terminar / fecho idle: não rearmar até nova intenção de marcação. */
export function isIdleSuppressed(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): boolean {
  const row = db.get<{ at: number | null }>(
    `SELECT idle_suppressed_at AS at FROM conversations
     WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  return row?.at != null
}

export function setIdleSuppressed(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  at: number,
): void {
  db.run(
    `UPDATE conversations
     SET idle_suppressed_at = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    at,
    at,
    tenantId,
    conversationId,
  )
}

/** Marcar outro / sessão de marcação / Prosseguir: volta a permitir idle. */
export function clearIdleSuppressed(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  updatedAt: number,
): void {
  db.run(
    `UPDATE conversations
     SET idle_suppressed_at = NULL, updated_at = ?
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
 * Após inbound/outbound útil: reinicia o prazo de fecho (+30 min) se elegível.
 * DEC-208: corre também com responsável humano activo (Assumir).
 * Após Terminar (`idle_suppressed_at`), small talk não rearma — Paulo 14/11/2026.
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
  if (!opp || isIdleSuppressed(db, tenantId, conversationId)) {
    clearConversationIdle(db, tenantId, conversationId, now)
    return null
  }
  const progressAt =
    opts?.progressAt ?? lastUsefulMessageAt(db, tenantId, conversationId) ?? now
  const dueAt = progressAt + IDLE_TIMEOUT_MS
  setConversationIdle(db, tenantId, conversationId, {
    phase: 'close',
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
