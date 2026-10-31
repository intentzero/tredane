/**
 * Migração 46 — idle conversacional (DEC-087 / épico #354 S5).
 * Prazo do alarme e fase do follow-up por conversa.
 */
export const MIGRATION_ID = 46
export const MIGRATION_NAME = '0046_conversation_idle'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE conversations
    ADD COLUMN idle_due_at INTEGER`,
  `ALTER TABLE conversations
    ADD COLUMN idle_phase TEXT
      CHECK (
        idle_phase IS NULL
        OR idle_phase IN ('prompt', 'close')
      )`,
  `ALTER TABLE conversations
    ADD COLUMN idle_prompt_sent_at INTEGER`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_idle_due
    ON conversations (tenant_id, idle_due_at)
    WHERE idle_due_at IS NOT NULL`,
]
