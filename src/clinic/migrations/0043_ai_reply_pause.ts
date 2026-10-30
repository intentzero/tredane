/**
 * Migração 43 — pausa da resposta automática (DEC-083).
 * A cliente pediu uma pessoa, ou a mensagem saiu do agendamento.
 * Assumir a conversa não religa a IA.
 */
export const MIGRATION_ID = 43
export const MIGRATION_NAME = '0043_ai_reply_pause'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE conversations ADD COLUMN ai_reply_paused_at INTEGER`,
  `ALTER TABLE conversations ADD COLUMN ai_reply_pause_reason TEXT`,
]
