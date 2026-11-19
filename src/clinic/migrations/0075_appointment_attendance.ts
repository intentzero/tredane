/**
 * DEC-205 / REQ-119: comparecimento no compromisso (chegou / não veio).
 * O status confirmed|cancelled não muda; a vaga continua ocupada.
 */
export const MIGRATION_ID = 75
export const MIGRATION_NAME = '0075_appointment_attendance'

export const STATEMENTS = [
  `ALTER TABLE appointments ADD COLUMN attendance TEXT
    CHECK (attendance IS NULL OR attendance IN ('arrived', 'no_show'))`,
] as const
