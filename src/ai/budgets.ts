/**
 * Orçamentos de contexto/timeout/custo (#41).
 * Limite de 20 mensagens = **Proposto** (DEC-011), não aprovado como hard product limit.
 */

/** Proposto — medir e rever com clínica piloto. */
export const AI_CONTEXT_MESSAGE_LIMIT_PROPOSED = 20

/** Timeout por chamada (ms). */
export const AI_TIMEOUT_MS = 15_000

export const AI_MAX_OUTPUT_TOKENS_REPLY = 512
export const AI_MAX_OUTPUT_TOKENS_SUMMARY = 256

/** Modelo rápido para resumo; mais capaz para sugestão — **Proposto** (ADR-0004). */
export const AI_MODEL_REPLY_PROPOSED = 'claude-sonnet-5-5'
export const AI_MODEL_SUMMARY_PROPOSED = 'claude-haiku-5-5'

export const AI_PROVIDER_ANTHROPIC = 'anthropic'
export const AI_PROVIDER_SYNTHETIC = 'synthetic'
