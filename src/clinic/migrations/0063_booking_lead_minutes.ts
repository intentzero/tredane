/**
 * Antecedência mínima para ofertas de horário (tenant-scoped em clinic_settings).
 */
export const MIGRATION_ID = 63
export const MIGRATION_NAME = '0063_booking_lead_minutes'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE clinic_settings ADD COLUMN booking_lead_minutes INTEGER NOT NULL DEFAULT 30`,
]
