/**
 * Migração 23 — requisito de sala «qualquer sala livre» (decisão do Paulo,
 * 28/10/2026). Reconstrói `service_room_requirements` com o CHECK a aceitar
 * `any`, copiando todas as linhas tal como estão (none/category/resource).
 */
export const MIGRATION_ID = 23
export const MIGRATION_NAME = '0023_room_requirement_any'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE service_room_requirements__m23 (
    tenant_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('none', 'category', 'resource', 'any')),
    category TEXT,
    resource_id TEXT,
    PRIMARY KEY (tenant_id, service_id)
  )`,
  `INSERT INTO service_room_requirements__m23
    (tenant_id, service_id, mode, category, resource_id)
    SELECT tenant_id, service_id, mode, category, resource_id
    FROM service_room_requirements`,
  `DROP TABLE service_room_requirements`,
  `ALTER TABLE service_room_requirements__m23 RENAME TO service_room_requirements`,
]
