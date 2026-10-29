/**
 * Horário semanal opcional por serviço (issue #261).
 * Vazio = sem filtro de serviço (comportamento anterior).
 */
export const MIGRATION_ID = 27
export const MIGRATION_NAME = '0027_service_weekly_windows'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS service_weekly_windows (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    start_minute INTEGER NOT NULL,
    end_minute INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_service_weekly_service
    ON service_weekly_windows (tenant_id, service_id, day_of_week)`,
]
