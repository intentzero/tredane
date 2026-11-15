/** Contador de incompreensões consecutivas na conversa (baseline 15/11/2026, aprovado pelo fundador). */
export const MIGRATION_ID = 70
export const MIGRATION_NAME = '0070_conversation_misunderstanding_streak'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE conversations ADD COLUMN ai_misunderstanding_streak INTEGER NOT NULL DEFAULT 0`,
]