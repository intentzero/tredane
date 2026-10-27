/**
 * Orçamentos de contexto/timeout/custo (#41).
 * Limite de 20 mensagens = **Proposto** (DEC-011), não aprovado como hard product limit.
 */

/** Proposto — medir e rever com clínica piloto. */
export const AI_CONTEXT_MESSAGE_LIMIT_PROPOSED = 20

/** Timeout por chamada (ms). */
export const AI_TIMEOUT_MS = 25_000

// Os modelos 5-5 pensam antes de responder e os tokens de thinking contam no
// max_tokens: com 512/256 a resposta saía cortada (reply) ou vazia (resumo).
export const AI_MAX_OUTPUT_TOKENS_REPLY = 2048
export const AI_MAX_OUTPUT_TOKENS_SUMMARY = 1536

/** Modelo rápido para resumo; mais capaz para sugestão — **Proposto** (ADR-0004). */
export const AI_MODEL_REPLY_PROPOSED = 'claude-sonnet-5-5'
/** Rascunho automático a cada mensagem recebida (aprovado 27/10/2026). */
export const AI_MODEL_AUTODRAFT = 'claude-haiku-5-5'
/** «Gerar outra» — modelo mais capaz. */
export const AI_MODEL_REGENERATE = 'claude-sonnet-5-5'
/** Temperatura das respostas (0.3–0.5 aprovado). */
export const AI_REPLY_TEMPERATURE = 0.4
/** Espera para juntar mensagens seguidas antes do rascunho automático (5–10 s aprovado). */
export const AI_AUTODRAFT_DEBOUNCE_MS = 7_000
/** Limite diário de rascunhos por clínica (aprovado). */
export const AI_DAILY_DRAFT_CAP = 300
export const AI_MODEL_SUMMARY_PROPOSED = 'claude-haiku-5-5'

export const AI_PROVIDER_ANTHROPIC = 'anthropic'
export const AI_PROVIDER_SYNTHETIC = 'synthetic'
