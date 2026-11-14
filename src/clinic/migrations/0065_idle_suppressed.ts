/**
 * DEC-087 — após Terminar, não rearmar idle em small talk (Paulo 14/11/2026).
 * `idle_suppressed_at` sticky até nova intenção de marcação / Marcar outro.
 */
export const MIGRATION_ID = 65
export const MIGRATION_NAME = '0065_idle_suppressed'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE conversations ADD COLUMN idle_suppressed_at INTEGER`,
]
