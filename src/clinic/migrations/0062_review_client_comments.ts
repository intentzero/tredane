/**
 * DEC-167 — todos os comentários Avaliar/feedback (append em re-flag).
 * Coluna JSON com a lista; `review_client_comment` (0061) mantém o 1.º.
 * Backfill lazy em `parseStoredClientComments` (não escapar JSON em SQL).
 */
export const MIGRATION_ID = 62
export const MIGRATION_NAME = '0062_review_client_comments'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE conversations ADD COLUMN review_client_comments TEXT`,
]
