/** Versão gravada por `0011_pix_webhook_receipts.sql` em `admin_schema_state`. */
export const ADMIN_SCHEMA_VERSION = 11

/** DEC-022: convite vale 7 dias (168 h) desde a emissão. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** DEC-024: cooldown mínimo entre reenvios. */
export const INVITATION_RESEND_COOLDOWN_MS = 10 * 60 * 1000

/** DEC-024: janela móvel de quota de reenvios. */
export const INVITATION_RESEND_WINDOW_MS = 24 * 60 * 60 * 1000

/** DEC-024: máximo de reenvios na janela (criação inicial não conta). */
export const INVITATION_RESEND_MAX = 5

/** DEC-031: pedido de suporte expira em 24 h. */
export const SUPPORT_REQUEST_TTL_MS = 24 * 60 * 60 * 1000

/** DEC-032: sessão de suporte dura 30 minutos após ativação. */
export const SUPPORT_SESSION_TTL_MS = 30 * 60 * 1000

export const LEGACY_OPERATIONAL_TABLES = ['services', 'professionals'] as const
