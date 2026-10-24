/**
 * Migração 7 — envio outbound, estados de entrega e modelos (#33 / REQ-012/013).
 * Acrescenta delivered/read; tabela outbound_messages (intenção ≠ compromisso);
 * catálogo local de modelos WhatsApp (sync sintético até GATE-10).
 */
export const MIGRATION_ID = 7
export const MIGRATION_NAME = '0007_outbound_send'

export const STATEMENTS: readonly string[] = [
  // SQLite não altera CHECK — rebuild de messages com delivered/read.
  `CREATE TABLE messages_v7 (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'system')),
    body TEXT NOT NULL,
    external_message_id TEXT,
    delivery_state TEXT NOT NULL CHECK (
      delivery_state IN (
        'received',
        'pending',
        'accepted',
        'delivered',
        'read',
        'failed',
        'unknown'
      )
    ),
    author_clerk_user_id TEXT,
    author_display_name TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id)
  )`,

  `INSERT INTO messages_v7 (
    id, tenant_id, conversation_id, direction, body,
    external_message_id, delivery_state,
    author_clerk_user_id, author_display_name, created_at
  )
  SELECT
    id, tenant_id, conversation_id, direction, body,
    external_message_id, delivery_state,
    author_clerk_user_id, author_display_name, created_at
  FROM messages`,

  `DROP TABLE messages`,

  `ALTER TABLE messages_v7 RENAME TO messages`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external
    ON messages (tenant_id, external_message_id)
    WHERE external_message_id IS NOT NULL`,

  `CREATE INDEX IF NOT EXISTS idx_messages_conv_time
    ON messages (tenant_id, conversation_id, created_at ASC)`,

  `CREATE TABLE IF NOT EXISTS outbound_messages (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    provider_message_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'template')),
    template_name TEXT,
    template_language TEXT,
    template_params_json TEXT,
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
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id),
    FOREIGN KEY (tenant_id, message_id) REFERENCES messages (tenant_id, id)
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_client_request
    ON outbound_messages (tenant_id, client_request_id)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_provider
    ON outbound_messages (tenant_id, provider_message_id)
    WHERE provider_message_id IS NOT NULL`,

  `CREATE INDEX IF NOT EXISTS idx_outbound_message
    ON outbound_messages (tenant_id, message_id)`,

  `CREATE TABLE IF NOT EXISTS whatsapp_templates (
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    language TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('approved', 'pending', 'rejected', 'paused')
    ),
    category TEXT NOT NULL,
    body_preview TEXT NOT NULL,
    param_keys_json TEXT NOT NULL,
    pricing_category TEXT,
    pricing_note TEXT NOT NULL,
    synced_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, name, language)
  )`,
]
