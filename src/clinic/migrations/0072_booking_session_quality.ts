/**
 * Contadores de qualidade na sessão analítica (DEC-148) — sem texto da cliente.
 */

export const MIGRATION_ID = 72
export const MIGRATION_NAME = '0072_booking_session_quality'

export const STATEMENTS = [
  `ALTER TABLE booking_sessions ADD COLUMN misunderstanding_turns INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE booking_sessions ADD COLUMN attendant_spontaneous INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE booking_sessions ADD COLUMN attendant_offered_rule INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE booking_sessions ADD COLUMN attendant_registered INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE booking_sessions ADD COLUMN attendant_last_step TEXT`,
  `ALTER TABLE booking_sessions ADD COLUMN confirmed_appointment_id TEXT`,
  `ALTER TABLE booking_sessions ADD COLUMN false_confirmation INTEGER NOT NULL DEFAULT 0`,
] as const