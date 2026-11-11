/** DEC-159 — retenção Confirmada: 30 dias no D1 central. */
export const REVIEW_SAMPLE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Máximo de mensagens no snapshot (mais recentes, ordem cronológica no store). */
export const REVIEW_SAMPLE_MESSAGE_LIMIT = 100

export const REVIEW_SAMPLES_SCOPE = 'review_samples:read' as const
