/**
 * Migração 4 — caixa de entrada partilhada (#29 / REQ-010/020/021).
 * Conversas, mensagens e atribuição no SQLite da clínica.
 * Hipótese (Em aberto / Proposto): uma conversa por contacto; nova mensagem
 * reabre se encerrada; histórico nunca é apagado. Motivo de encerramento e
 * anexos ficam fora deste schema.
 */
export const MIGRATION_ID = 4
export const MIGRATION_NAME = '0004_inbox'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('new', 'open', 'closed')),
    assignee_clerk_user_id TEXT,
    assignee_display_name TEXT,
    assignment_version INTEGER NOT NULL DEFAULT 0,
    last_message_at INTEGER,
    last_message_preview TEXT,
    last_message_direction TEXT CHECK (
      last_message_direction IS NULL
      OR last_message_direction IN ('inbound', 'outbound', 'system')
    ),
    unread_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_conversations_list
    ON conversations (tenant_id, last_message_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_conversations_status
    ON conversations (tenant_id, status)`,

  `CREATE INDEX IF NOT EXISTS idx_conversations_contact
    ON conversations (tenant_id, contact_id, updated_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_conversations_assignee
    ON conversations (tenant_id, assignee_clerk_user_id)`,

  `CREATE TABLE IF NOT EXISTS messages (
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

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external
    ON messages (tenant_id, external_message_id)
    WHERE external_message_id IS NOT NULL`,

  `CREATE INDEX IF NOT EXISTS idx_messages_conv_time
    ON messages (tenant_id, conversation_id, created_at ASC)`,
]
