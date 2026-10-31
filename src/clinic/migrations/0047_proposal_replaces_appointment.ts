/**
 * Migração 47 — proposta de reagendamento (DEC-091 / REQ-101).
 * Ligação opcional ao compromisso que o clique Confirmar actualiza.
 */
export const MIGRATION_ID = 47
export const MIGRATION_NAME = '0047_proposal_replaces_appointment'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE appointment_proposals
    ADD COLUMN replaces_appointment_id TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_appointment_proposals_replaces
    ON appointment_proposals (tenant_id, replaces_appointment_id)
    WHERE replaces_appointment_id IS NOT NULL`,
]
