/**
 * Migração 8 — metadados de anexos privados R2 (#34 / DEC-038, REQ-001/071).
 * Blobs em R2 (`tenants/{tenantId}/attachments/{id}`); SQLite só metadados.
 * Estados: pending | ready | unavailable | failed. Sem I/O R2 na TX.
 */
export const MIGRATION_ID = 8
export const MIGRATION_NAME = '0008_attachments'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    message_id TEXT,
    conversation_id TEXT,
    r2_key TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL DEFAULT 0,
    filename TEXT,
    sha256 TEXT,
    source TEXT NOT NULL CHECK (
      source IN ('whatsapp_inbound', 'human_upload', 'synthetic')
    ),
    provider_media_id TEXT,
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'ready', 'unavailable', 'failed')
    ),
    failure_code TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ready_at INTEGER,
    deleted_at INTEGER,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, message_id) REFERENCES messages (tenant_id, id),
    FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_attachments_message
    ON attachments (tenant_id, message_id)`,

  `CREATE INDEX IF NOT EXISTS idx_attachments_conversation
    ON attachments (tenant_id, conversation_id, created_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_attachments_status
    ON attachments (tenant_id, status, updated_at)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_provider_media
    ON attachments (tenant_id, provider_media_id)
    WHERE provider_media_id IS NOT NULL AND deleted_at IS NULL`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_r2_key
    ON attachments (tenant_id, r2_key)
    WHERE deleted_at IS NULL`,
]
