/**
 * Migração 22 — bloquear contato (Proposto, 27/10/2026; ver ux-ui.md §TEL-01).
 * - contacts: instante do bloqueio, quem bloqueou e motivo opcional (só equipe).
 * Mensagens novas de um número bloqueado não criam conversa nem mensagem;
 * o histórico e os compromissos existentes são mantidos.
 */
export const MIGRATION_ID = 22
export const MIGRATION_NAME = '0022_contact_block'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE contacts ADD COLUMN blocked_at INTEGER`,
  `ALTER TABLE contacts ADD COLUMN blocked_by_display_name TEXT`,
  `ALTER TABLE contacts ADD COLUMN blocked_reason TEXT`,
]
