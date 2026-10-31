/**
 * Migração 48 — a sessão de agendamento lembra as variantes e o horário
 * já ditos, para a pergunta seguinte não os pedir de novo.
 */
export const MIGRATION_ID = 48
export const MIGRATION_NAME = '0048_schedule_session_memory'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE schedule_sessions ADD COLUMN variant_ids TEXT`,
  `ALTER TABLE schedule_sessions ADD COLUMN clock_time TEXT`,
]
