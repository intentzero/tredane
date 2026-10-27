/**
 * Migração 20 — duração ajustável no Agendar (DEC-051, Confirmado por Paulo,
 * card t1868s7504, 27/10/2026).
 * - services: a owner marca o serviço como «duração ajustável» e define
 *   mínimo/máximo (múltiplos de 15 min).
 * - appointments: duração padrão do serviço e duração aplicada no momento da
 *   marcação (o histórico guarda ambas no snapshot).
 */
export const MIGRATION_ID = 20
export const MIGRATION_NAME = '0020_adjustable_duration'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE services ADD COLUMN duration_adjustable INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE services ADD COLUMN duration_min_minutes INTEGER`,
  `ALTER TABLE services ADD COLUMN duration_max_minutes INTEGER`,
  `ALTER TABLE appointments ADD COLUMN default_duration_minutes INTEGER`,
  `ALTER TABLE appointments ADD COLUMN applied_duration_minutes INTEGER`,
]
