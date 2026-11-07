/** DEC-145 — modo uma | varias por serviço (default varias). */

export const MIGRATION_ID = 55
export const MIGRATION_NAME = '0055_variant_selection'

export const STATEMENTS = [
  `ALTER TABLE services ADD COLUMN variant_selection TEXT NOT NULL DEFAULT 'varias'
    CHECK (variant_selection IN ('uma', 'varias'))`,
] as const
