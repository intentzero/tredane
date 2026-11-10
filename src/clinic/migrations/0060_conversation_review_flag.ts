/**
 * DEC-157 — flag de revisão de conversa (fila «Para revisão»).
 * Não pausa a IA; corpos ficam nas messages do DO (não no analytics DEC-148).
 */
export const MIGRATION_ID = 60
export const MIGRATION_NAME = '0060_conversation_review_flag'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE conversations ADD COLUMN review_flagged_at INTEGER`,
  `ALTER TABLE conversations ADD COLUMN review_flagged_source TEXT`,
  `ALTER TABLE conversations ADD COLUMN review_flag_reason TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_review_flagged
    ON conversations (tenant_id, review_flagged_at DESC)
    WHERE review_flagged_at IS NOT NULL`,
]
