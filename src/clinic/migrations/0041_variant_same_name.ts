/**
 * Migração 41 — o nome da variante pode repetir (Paulo, 30/10/2026).
 * Duas linhas só coincidem quando nome, género, duração e preço são os mesmos.
 * Preço vazio entra como -1 no índice: o UNIQUE do SQLite trata NULL como distinto.
 */
export const MIGRATION_ID = 41
export const MIGRATION_NAME = '0041_variant_same_name'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE service_zones_next (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    price_cents INTEGER,
    audience TEXT NOT NULL DEFAULT 'ambos'
      CHECK (audience IN ('feminino', 'masculino', 'ambos')),
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `INSERT INTO service_zones_next (
     id, tenant_id, service_id, name, duration_minutes, price_cents, audience,
     active, sort_order, created_at, updated_at
   )
   SELECT
     id, tenant_id, service_id, name, duration_minutes, price_cents, audience,
     active, sort_order, created_at, updated_at
   FROM service_zones`,
  `DROP TABLE service_zones`,
  `ALTER TABLE service_zones_next RENAME TO service_zones`,
  `CREATE INDEX service_zones_service ON service_zones (tenant_id, service_id, sort_order)`,
  `CREATE UNIQUE INDEX service_zones_identity ON service_zones (
     tenant_id,
     service_id,
     name COLLATE NOCASE,
     audience,
     duration_minutes,
     ifnull(price_cents, -1)
   )`,
]
