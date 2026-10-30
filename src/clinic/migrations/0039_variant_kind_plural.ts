/** DEC-079 — o tipo das variantes tem singular e plural. */

export const MIGRATION_ID = 39
export const MIGRATION_NAME = '0039_variant_kind_plural'

export const STATEMENTS = [
  `ALTER TABLE services ADD COLUMN variant_kind_plural TEXT`,
] as const
