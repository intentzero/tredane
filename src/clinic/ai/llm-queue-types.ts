/**
 * Contrato da fila dedicada `tredane-llm-*` (DEC-188 / #784).
 * Não reutiliza `tredane-inbound-*`.
 *
 * Job irmão `llm_shadow`: medição H1 sem claim/apply no DO (DEC-188 — Claude
 * da sombra também fora do Clinic DO).
 */

import type { InterpreterShadowTask } from './interpreter-shadow'

export type LlmJobPurpose = 'extract' | 'redact'

export type LlmQueueMessage = {
  source: 'llm_job'
  tenantId: string
  jobId: string
  conversationId: string
  messageId: string
  purpose: LlmJobPurpose
  idempotencyKey: string
}

/** Sibling job: só mede; não toca quadro / outbox / teto diário. */
export type LlmShadowQueueMessage = {
  source: 'llm_shadow'
  tenantId: string
  conversationId: string
  messageId: string
  task: InterpreterShadowTask
}

export type LlmQueueEnvelope = LlmQueueMessage | LlmShadowQueueMessage

export function isLlmQueueMessage(body: unknown): body is LlmQueueMessage {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    b.source === 'llm_job' &&
    typeof b.tenantId === 'string' &&
    typeof b.jobId === 'string' &&
    typeof b.idempotencyKey === 'string' &&
    (b.purpose === 'extract' || b.purpose === 'redact')
  )
}

export function isLlmShadowQueueMessage(body: unknown): body is LlmShadowQueueMessage {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  if (b.source !== 'llm_shadow') return false
  if (typeof b.tenantId !== 'string' || typeof b.conversationId !== 'string') return false
  if (typeof b.messageId !== 'string' || !b.task || typeof b.task !== 'object') return false
  return true
}

export function isLlmQueueEnvelope(body: unknown): body is LlmQueueEnvelope {
  return isLlmQueueMessage(body) || isLlmShadowQueueMessage(body)
}

export function buildLlmShadowQueueMessage(task: InterpreterShadowTask): LlmShadowQueueMessage {
  return {
    source: 'llm_shadow',
    tenantId: task.tenantId,
    conversationId: task.conversationId,
    messageId: task.messageId,
    task,
  }
}

/** Teto do poll Lab até apply (DEC-188). */
export const LAB_LLM_WAIT_MS = 18_000
export const LAB_LLM_POLL_MS = 250

/** Lease do claim (espelha outbound ~60s; Claude costuma <15s). */
export const LLM_CLAIM_STALE_MS = 60_000
