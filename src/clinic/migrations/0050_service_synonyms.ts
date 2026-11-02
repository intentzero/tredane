/**
 * Migração 50 — sinónimos por serviço e variante (DEC-110 / #421).
 * Lista curta de textos para interpretação; nunca enviados à cliente.
 */
export const MIGRATION_ID = 50
export const MIGRATION_NAME = '0050_service_synonyms'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE services ADD COLUMN synonyms_json TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE service_zones ADD COLUMN synonyms_json TEXT NOT NULL DEFAULT '[]'`,
]
