/**
 * Migração 19 — rascunho automático da IA e «Lida por» (aprovado por Paulo, 27/10/2026).
 * - clinic_settings: endereço e regras de remarcação/cancelamento (contexto da IA).
 * - ai_suggestions: mensagem a que o rascunho responde + origem (auto/manual).
 * - ai_autodraft_jobs: um job pendente por conversa (debounce de mensagens seguidas).
 * - ai_daily_usage: limite diário de rascunhos por clínica.
 * - messages: quem leu (na clínica) e quando.
 */
export const MIGRATION_ID = 19
export const MIGRATION_NAME = '0019_ai_autodraft_read_receipts'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE clinic_settings ADD COLUMN clinic_address TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE clinic_settings ADD COLUMN reschedule_policy TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE ai_suggestions ADD COLUMN reply_to_message_id TEXT`,
  `ALTER TABLE ai_suggestions ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'`,
  `ALTER TABLE ai_suggestions ADD COLUMN internal_notes TEXT NOT NULL DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS ai_autodraft_jobs (
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    due_at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'generating')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, conversation_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ai_autodraft_due ON ai_autodraft_jobs (tenant_id, due_at)`,
  `CREATE TABLE IF NOT EXISTS ai_daily_usage (
    tenant_id TEXT NOT NULL,
    day TEXT NOT NULL,
    drafts INTEGER NOT NULL DEFAULT 0,
    cap_reached_at INTEGER,
    PRIMARY KEY (tenant_id, day)
  )`,
  `ALTER TABLE messages ADD COLUMN read_by_clerk_user_id TEXT`,
  `ALTER TABLE messages ADD COLUMN read_by_display_name TEXT`,
  `ALTER TABLE messages ADD COLUMN read_at INTEGER`,
]
