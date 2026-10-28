/**
 * Migração 24 — horário da clínica com herança (Proposto, 28/10/2026; ver
 * ux-ui.md TEL-09). O expediente da clínica vive em `weekly_windows` com o
 * escopo reservado `__clinic__`; a profissional escolhe seguir o da clínica
 * (`hours_mode = 'clinic'`) ou ter horário próprio (`'own'`, o comportamento
 * de antes — todas as existentes ficam em `own`).
 */
export const MIGRATION_ID = 24
export const MIGRATION_NAME = '0024_clinic_hours'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE resources ADD COLUMN hours_mode TEXT NOT NULL DEFAULT 'own' CHECK (hours_mode IN ('clinic', 'own'))`,
]
