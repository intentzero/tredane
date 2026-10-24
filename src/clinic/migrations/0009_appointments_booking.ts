/**
 * Migração 9 — agendamento atómico (#36 / DEC-008/040, REQ-031–034, ADR-0005).
 * Alocações por recurso, histórico, idempotência de comando e versão.
 * Sem Pix (#37+) e sem recorrência.
 */
export const MIGRATION_ID = 9
export const MIGRATION_NAME = '0009_appointments_booking'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE appointments ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE appointments ADD COLUMN updated_at INTEGER`,
  `ALTER TABLE appointments ADD COLUMN confirmed_by TEXT`,
  `ALTER TABLE appointments ADD COLUMN confirmed_at INTEGER`,
  `ALTER TABLE appointments ADD COLUMN change_reason TEXT`,
  `ALTER TABLE appointments ADD COLUMN cancelled_by TEXT`,
  `ALTER TABLE appointments ADD COLUMN cancelled_at INTEGER`,
  `ALTER TABLE appointments ADD COLUMN occupies_until INTEGER`,

  `CREATE TABLE IF NOT EXISTS appointment_allocations (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    appointment_id TEXT NOT NULL,
    resource_kind TEXT NOT NULL CHECK (
      resource_kind IN ('professional', 'room', 'equipment')
    ),
    resource_id TEXT NOT NULL,
    occupied_from INTEGER NOT NULL,
    occupied_until INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_allocations_resource_time
    ON appointment_allocations (
      tenant_id, resource_kind, resource_id, occupied_from, occupied_until
    )`,

  `CREATE INDEX IF NOT EXISTS idx_allocations_appointment
    ON appointment_allocations (tenant_id, appointment_id)`,

  `CREATE TABLE IF NOT EXISTS appointment_events (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    appointment_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (
      operation IN ('confirmed', 'cancelled', 'rescheduled')
    ),
    actor_id TEXT,
    reason TEXT,
    previous_json TEXT,
    new_json TEXT,
    occurred_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_appointment_events_apt
    ON appointment_events (tenant_id, appointment_id, occurred_at)`,

  /**
   * Idempotência de clique/retry (confirm/cancel/reschedule).
   * Retry com o mesmo client_request_id devolve o resultado gravado.
   */
  `CREATE TABLE IF NOT EXISTS appointment_commands (
    tenant_id TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    command TEXT NOT NULL CHECK (
      command IN ('confirm', 'cancel', 'reschedule')
    ),
    appointment_id TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, client_request_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_appointment_commands_apt
    ON appointment_commands (tenant_id, appointment_id)`,
]
