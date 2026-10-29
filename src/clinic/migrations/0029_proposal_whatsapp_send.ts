/**
 * Migração 29 — S4 (#175): envio interativo da proposta + links de outbox + H7.
 * - `outbound_messages.kind` passa a aceitar `interactive` (rebuild CHECK SQLite).
 * - Colunas de ligação proposta ↔ mensagem/outbox.
 * - Tabela `pending_communications` (alerta aos 5 min, DEC-061 / H7).
 */
export const MIGRATION_ID = 29
export const MIGRATION_NAME = '0029_proposal_whatsapp_send'

export const STATEMENTS: readonly string[] = [
  // SQLite não altera CHECK — rebuild de outbound_messages com kind interactive.
  `CREATE TABLE outbound_messages_v29 (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    provider_message_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'template', 'interactive')),
    template_name TEXT,
    template_language TEXT,
    template_params_json TEXT,
    interactive_json TEXT,
    delivery_state TEXT NOT NULL CHECK (
      delivery_state IN (
        'pending',
        'accepted',
        'delivered',
        'read',
        'failed',
        'unknown'
      )
    ),
    failure_reason TEXT,
    outbox_event_id TEXT,
    ai_suggestion_id TEXT,
    ai_origin_note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id),
    FOREIGN KEY (tenant_id, message_id) REFERENCES messages (tenant_id, id)
  )`,

  `INSERT INTO outbound_messages_v29 (
    id, tenant_id, conversation_id, message_id, client_request_id,
    provider_message_id, kind, template_name, template_language,
    template_params_json, interactive_json, delivery_state, failure_reason,
    outbox_event_id, ai_suggestion_id, ai_origin_note, created_at, updated_at
  )
  SELECT
    id, tenant_id, conversation_id, message_id, client_request_id,
    provider_message_id, kind, template_name, template_language,
    template_params_json, NULL, delivery_state, failure_reason,
    outbox_event_id, ai_suggestion_id, ai_origin_note, created_at, updated_at
  FROM outbound_messages`,

  `DROP TABLE outbound_messages`,

  `ALTER TABLE outbound_messages_v29 RENAME TO outbound_messages`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_client_request
    ON outbound_messages (tenant_id, client_request_id)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_provider
    ON outbound_messages (tenant_id, provider_message_id)
    WHERE provider_message_id IS NOT NULL`,

  `CREATE INDEX IF NOT EXISTS idx_outbound_message
    ON outbound_messages (tenant_id, message_id)`,

  `ALTER TABLE appointment_proposals ADD COLUMN send_outbound_id TEXT`,
  `ALTER TABLE appointment_proposals ADD COLUMN send_message_id TEXT`,
  `ALTER TABLE appointment_proposals ADD COLUMN send_provider_message_id TEXT`,
  `ALTER TABLE appointment_proposals ADD COLUMN result_outbound_id TEXT`,
  `ALTER TABLE appointment_proposals ADD COLUMN result_kind TEXT`,

  `CREATE TABLE IF NOT EXISTS pending_communications (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    proposal_id TEXT,
    kind TEXT NOT NULL CHECK (
      kind IN (
        'proposal_send',
        'result_send',
        'alter_awaiting_team'
      )
    ),
    status TEXT NOT NULL CHECK (status IN ('open', 'alerted', 'resolved')),
    started_at INTEGER NOT NULL,
    alert_after_at INTEGER NOT NULL,
    alerted_at INTEGER,
    resolved_at INTEGER,
    outbound_id TEXT,
    message_id TEXT,
    detail_text TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_pending_comm_open
    ON pending_communications (tenant_id, status, alert_after_at)`,

  `CREATE INDEX IF NOT EXISTS idx_pending_comm_conversation
    ON pending_communications (tenant_id, conversation_id, status)`,

  `CREATE INDEX IF NOT EXISTS idx_pending_comm_proposal
    ON pending_communications (tenant_id, proposal_id, kind, status)`,
]
