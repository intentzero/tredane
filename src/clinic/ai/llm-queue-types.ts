/**
 * Contrato da fila dedicada `tredane-llm-*` (DEC-188 / #784).
 * Não reutiliza `tredane-inbound-*`.
 */

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

/** Teto do poll Lab até apply (DEC-188). */
export const LAB_LLM_WAIT_MS = 18_000
export const LAB_LLM_POLL_MS = 250

/** Lease do claim (espelha outbound ~60s; Claude costuma <15s). */
export const LLM_CLAIM_STALE_MS = 60_000
