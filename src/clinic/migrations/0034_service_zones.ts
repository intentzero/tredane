/**
 * Migração 34 — zonas do serviço (DEC-078 / épico #293).
 * A linha do serviço permanece. A visita guarda uma cópia das zonas escolhidas.
 */
export const MIGRATION_ID = 34
export const MIGRATION_NAME = '0034_service_zones'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE service_zones (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    price_cents INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (tenant_id, service_id, name)
  )`,
  `CREATE INDEX service_zones_service ON service_zones (tenant_id, service_id, sort_order)`,
  `CREATE TABLE visit_zone_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    zone_id TEXT,
    name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    price_cents INTEGER,
    sort_order INTEGER NOT NULL
  )`,
  `CREATE INDEX visit_zone_snapshots_owner
    ON visit_zone_snapshots (tenant_id, owner_kind, owner_id, sort_order)`,
]
