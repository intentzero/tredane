/**
 * DEC-153 — flag one-shot da dica «falar com a equipe» na 1.ª oferta de horários.
 * Coluna em `schedule_sessions`; some com o quadro (DELETE limpa).
 */
export const MIGRATION_ID = 58
export const MIGRATION_NAME = '0058_human_help_hint'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE schedule_sessions ADD COLUMN human_help_hint_sent INTEGER NOT NULL DEFAULT 0`,
]
