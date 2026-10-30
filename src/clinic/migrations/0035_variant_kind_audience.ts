/** DEC-079 — tipo livre do serviço e género de cada variante. */

export const MIGRATION_ID = 35
export const MIGRATION_NAME = '0035_variant_kind_audience'

export const STATEMENTS = [
  `ALTER TABLE services ADD COLUMN variant_kind TEXT`,
  `ALTER TABLE service_zones ADD COLUMN audience TEXT NOT NULL DEFAULT 'ambos'
    CHECK (audience IN ('feminino', 'masculino', 'ambos'))`,
  `ALTER TABLE visit_zone_snapshots ADD COLUMN audience TEXT
    CHECK (audience IS NULL OR audience IN ('feminino', 'masculino', 'ambos'))`,
] as const
