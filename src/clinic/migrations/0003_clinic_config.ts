/**
 * Migração 3 — configuração da clínica (issue #28 / DEC-008/014/042/046).
 * Serviços, recursos (profissional/sala/equipamento), expediente, bloqueios,
 * fuso e compromissos mínimos para impacto de bloqueio (agenda completa em fatias posteriores).
 */
export const MIGRATION_ID = 3
export const MIGRATION_NAME = '0003_clinic_config'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS clinic_settings (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    tenant_id TEXT NOT NULL UNIQUE,
    timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS services (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    buffer_minutes INTEGER NOT NULL DEFAULT 0,
    price_cents INTEGER,
    client_explanation TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_services_active
    ON services (tenant_id, active)`,

  `CREATE TABLE IF NOT EXISTS resources (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('professional', 'room', 'equipment')),
    name TEXT NOT NULL,
    category TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_resources_kind
    ON resources (tenant_id, kind, active)`,

  `CREATE TABLE IF NOT EXISTS service_professionals (
    tenant_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    professional_id TEXT NOT NULL,
    PRIMARY KEY (tenant_id, service_id, professional_id)
  )`,

  `CREATE TABLE IF NOT EXISTS service_room_requirements (
    tenant_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('none', 'category', 'resource')),
    category TEXT,
    resource_id TEXT,
    PRIMARY KEY (tenant_id, service_id)
  )`,

  `CREATE TABLE IF NOT EXISTS weekly_windows (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    start_minute INTEGER NOT NULL,
    end_minute INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_weekly_resource
    ON weekly_windows (tenant_id, resource_id, day_of_week)`,

  `CREATE TABLE IF NOT EXISTS resource_blocks (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    reason TEXT NOT NULL CHECK (
      reason IN ('folga', 'ferias', 'feriado', 'manutencao', 'outro')
    ),
    note TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_blocks_resource_time
    ON resource_blocks (tenant_id, resource_id, starts_at, ends_at)`,

  /**
   * Compromissos mínimos — listagem de impacto em bloqueios (DEC-008).
   * UI/agenda completa e confirmação atómica ficam fora deste recorte (#28).
   */
  `CREATE TABLE IF NOT EXISTS appointments (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    professional_id TEXT NOT NULL,
    room_resource_id TEXT,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
    contact_label TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_appointments_time
    ON appointments (tenant_id, status, starts_at, ends_at)`,

  `CREATE INDEX IF NOT EXISTS idx_appointments_professional
    ON appointments (tenant_id, professional_id, status, starts_at)`,

  `CREATE INDEX IF NOT EXISTS idx_appointments_room
    ON appointments (tenant_id, room_resource_id, status, starts_at)`,
]
