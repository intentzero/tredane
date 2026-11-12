/**
 * DEC-166 — comentário livre opcional no flag de revisão (WhatsApp «avaliar …»).
 * First-flag-wins: coluna só preenchida na 1.ª marcação; clear zera.
 */
export const MIGRATION_ID = 61
export const MIGRATION_NAME = '0061_review_client_comment'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE conversations ADD COLUMN review_client_comment TEXT`,
]
