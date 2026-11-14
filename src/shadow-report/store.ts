/**
 * TEMPORÁRIO: armazenamento dos eventos da sombra do interpretador LLM no D1 central, para o
 * Review MCP os agregar (`get_interpreter_shadow_report`). Ver hipotese-compreensao-llm-primeiro.md §5.3d.
 *
 * Só ids e veredictos por campo: nunca texto da conversa. TTL de 7 dias. Escrita fail-soft:
 * quem chama nunca deve falhar por causa da medição. REMOVER quando a H1 estiver decidida
 * (lista de remoção no mesmo documento).
 */
import type { AsyncAdminDb } from '../db/admin/async-store'
import type { InterpreterShadowEvent } from '../clinic/ai/interpreter-shadow'

export const SHADOW_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type ShadowEventRow = {
  tenant_id: string
  conversation_id: string
  message_id: string
  occurred_at: number
  expires_at: number
  status: string
  main_model_called: number
  reused_main_call: number
  pending_slot: string | null
  rule_coverage: number | null
  diverged: number
  fields_json: string | null
  llm_only_json: string | null
  differ_json: string | null
  strict_discarded_json: string | null
  relaxed_rejected_json: string | null
  rule_acts_json: string | null
  llm_acts_json: string | null
  model: string | null
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
}

const json = (v: unknown): string | null => (v == null ? null : JSON.stringify(v))

/** Grava um evento (idempotente por turno) e apaga os expirados. Nunca lança. */
export async function insertInterpreterShadowEvent(
  db: AsyncAdminDb,
  e: InterpreterShadowEvent,
  nowMs: number,
): Promise<void> {
  try {
    await db.run(
      `INSERT INTO interpreter_shadow_events (
         id, tenant_id, conversation_id, message_id, occurred_at, expires_at, status,
         main_model_called, reused_main_call, pending_slot, rule_coverage, diverged,
         fields_json, llm_only_json, differ_json, strict_discarded_json, relaxed_rejected_json,
         rule_acts_json, llm_acts_json, model, latency_ms, input_tokens, output_tokens
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, conversation_id, message_id) DO NOTHING`,
      `ise_${e.tenantId}_${e.conversationId}_${e.messageId}`,
      e.tenantId,
      e.conversationId,
      e.messageId,
      nowMs,
      nowMs + SHADOW_EVENT_TTL_MS,
      e.status,
      e.mainModelCalled ? 1 : 0,
      e.reusedMainCall ? 1 : 0,
      e.pendingSlot,
      e.ruleCoverage,
      e.diverged ? 1 : 0,
      json(e.fields),
      json(e.llmOnly),
      json(e.differ),
      json(e.strictDiscarded),
      json(e.relaxedRejected),
      json(e.ruleActs),
      json(e.llmActs),
      e.model,
      e.latencyMs,
      e.inputTokens,
      e.outputTokens,
    )
    await db.run(`DELETE FROM interpreter_shadow_events WHERE expires_at < ?`, nowMs)
  } catch {
    // Medição temporária: nunca afeta o atendimento.
  }
}

export async function listInterpreterShadowEvents(
  db: AsyncAdminDb,
  opts: { sinceMs: number; tenantId?: string | null; limit?: number },
): Promise<ShadowEventRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 5000, 1), 5000)
  if (opts.tenantId) {
    return db.all<ShadowEventRow>(
      `SELECT * FROM interpreter_shadow_events
       WHERE occurred_at >= ? AND tenant_id = ? ORDER BY occurred_at DESC LIMIT ?`,
      opts.sinceMs,
      opts.tenantId,
      limit,
    )
  }
  return db.all<ShadowEventRow>(
    `SELECT * FROM interpreter_shadow_events WHERE occurred_at >= ? ORDER BY occurred_at DESC LIMIT ?`,
    opts.sinceMs,
    limit,
  )
}
