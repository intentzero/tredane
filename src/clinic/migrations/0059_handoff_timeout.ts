/**
 * DEC-155 — prazo de devolução automática à IA após handoff sem Assumir (30 min).
 * Coluna em `conversations`; limpa em Assumir / Devolver à IA / timeout.
 */
export const MIGRATION_ID = 59
export const MIGRATION_NAME = '0059_handoff_timeout'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE conversations ADD COLUMN ai_handoff_timeout_at INTEGER`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_handoff_timeout
    ON conversations (tenant_id, ai_handoff_timeout_at)
    WHERE ai_handoff_timeout_at IS NOT NULL`,
]
