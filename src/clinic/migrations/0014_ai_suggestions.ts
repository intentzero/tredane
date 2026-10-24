/**
 * Migração 14 — IA assistiva (#41 / DEC-011/040/046):
 * sugestões com revisão humana, sem envio autónomo.
 */
export const MIGRATION_ID = 14
export const MIGRATION_NAME = '0014_ai_suggestions'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ai_suggestions (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('reply', 'summary')),
    status TEXT NOT NULL CHECK (
      status IN (
        'pending', 'used', 'edited', 'discarded', 'failed', 'superseded'
      )
    ),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    suggested_text TEXT NOT NULL DEFAULT '',
    warning_codes_json TEXT NOT NULL DEFAULT '[]',
    warning_labels_json TEXT NOT NULL DEFAULT '[]',
    source_refs_json TEXT NOT NULL DEFAULT '[]',
    request_meta_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT,
    requested_by_clerk_user_id TEXT NOT NULL,
    requested_by_display_name TEXT,
    decision TEXT CHECK (
      decision IS NULL OR decision IN ('use', 'edit', 'discard', 'regenerate')
    ),
    decided_by_clerk_user_id TEXT,
    decided_at INTEGER,
    revised_text TEXT,
    outbound_message_id TEXT,
    parent_suggestion_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, conversation_id)
      REFERENCES conversations (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_ai_suggestions_conversation
    ON ai_suggestions (tenant_id, conversation_id, created_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_ai_suggestions_status
    ON ai_suggestions (tenant_id, conversation_id, status, kind)`,

  /**
   * Idempotência de pedido explícito (sugerir / resumir / decidir).
   * Nunca envia WhatsApp — só persiste sugestão e decisão humana.
   */
  `CREATE TABLE IF NOT EXISTS ai_commands (
    tenant_id TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    command TEXT NOT NULL CHECK (
      command IN ('suggest_reply', 'summarize', 'decide')
    ),
    conversation_id TEXT,
    suggestion_id TEXT,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, client_request_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_ai_commands_conversation
    ON ai_commands (tenant_id, conversation_id)`,

  /** Origem assistiva no envio humano (histórico interno, não para o contacto). */
  `ALTER TABLE outbound_messages ADD COLUMN ai_suggestion_id TEXT`,
  `ALTER TABLE outbound_messages ADD COLUMN ai_origin_note TEXT`,
]
