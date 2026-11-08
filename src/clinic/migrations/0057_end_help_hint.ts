/**
 * DEC-152 — flag one-shot do hint «Se quiser parar, diga terminar.»
 * Coluna em `schedule_sessions`; some com o quadro (DELETE limpa).
 */
export const MIGRATION_ID = 57
export const MIGRATION_NAME = '0057_end_help_hint'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE schedule_sessions ADD COLUMN end_help_hint_sent INTEGER NOT NULL DEFAULT 0`,
]
