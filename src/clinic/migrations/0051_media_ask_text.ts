/**
 * Migração 51 — estado «já pedi texto» por mídia (CF-26 / #475 S3).
 * Facto na conversa; não ler o corpo outbound (mesmo erro do CF-22).
 * Expiração do marcador: Em aberto — aguarda Paulo (issue #475).
 */
export const MIGRATION_ID = 51
export const MIGRATION_NAME = '0051_media_ask_text'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE conversations ADD COLUMN media_ask_text_at INTEGER`,
]
