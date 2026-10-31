/**
 * Migração 44 — sessão de agendamento da conversa (detalhe de DEC-078 / DEC-075).
 * Linha, dia e período ficam nesta sessão, não na ficha do contacto.
 * Ainda não publicada: as colunas entram no CREATE, sem migração 45.
 */
export const MIGRATION_ID = 44
export const MIGRATION_NAME = '0044_schedule_session'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS schedule_sessions (
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    audience_line TEXT CHECK (audience_line IS NULL OR audience_line IN ('feminino', 'masculino')),
    day_label TEXT CHECK (day_label IS NULL OR day_label IN (
      'hoje', 'amanhã', 'depois de amanhã',
      'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'
    )),
    period TEXT CHECK (period IS NULL OR period IN ('manha', 'tarde', 'noite')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, conversation_id),
    FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id)
  )`,
]
