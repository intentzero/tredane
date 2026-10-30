/**
 * Migração 39 — plural do tipo das variantes (DEC-079, revisão de 30/10/2026).
 * `variant_kind` passa a ser o singular; sem plural gravado, a interface sugere.
 */
export const MIGRATION_ID = 39
export const MIGRATION_NAME = '0039_variant_kind_plural'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE services ADD COLUMN variant_kind_plural TEXT`,
]
