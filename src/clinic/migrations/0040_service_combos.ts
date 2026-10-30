/**
 * Migração 40 — combos de variantes (DEC-080).
 * Um combo é um conjunto de 2 ou mais variantes do mesmo serviço com preço próprio.
 * A visita guarda uma cópia do combo aplicado (nome e preço), como faz com as variantes.
 */
export const MIGRATION_ID = 40
export const MIGRATION_NAME = '0040_service_combos'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE service_combos (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents > 0),
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (tenant_id, service_id, name)
  )`,
  `CREATE INDEX service_combos_service ON service_combos (tenant_id, service_id, sort_order)`,
  `CREATE TABLE service_combo_items (
    tenant_id TEXT NOT NULL,
    combo_id TEXT NOT NULL,
    zone_id TEXT NOT NULL,
    PRIMARY KEY (combo_id, zone_id)
  )`,
  `CREATE INDEX service_combo_items_zone ON service_combo_items (tenant_id, zone_id)`,
  `CREATE TABLE visit_combo_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    combo_id TEXT,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    list_price_cents INTEGER NOT NULL
  )`,
  `CREATE INDEX visit_combo_snapshots_owner
    ON visit_combo_snapshots (tenant_id, owner_kind, owner_id)`,
]
