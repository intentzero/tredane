/**
 * Migração 44 — sessão de agendamento da conversa (detalhe de DEC-078 / DEC-075).
 * A linha feminina ou masculina fica nesta sessão, não na ficha do contacto.
 */
export const MIGRATION_ID = 44
export const MIGRATION_NAME = '0044_schedule_session'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS schedule_sessions (
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    audience_line TEXT CHECK (audience_line IS NULL OR audience_line IN ('feminino', 'masculino')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, conversation_id),
    FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id)
  )`,
]
