/**
 * Migração 6 — espelho operacional do canal WhatsApp (#31 / REQ-051).
 * Fonte de verdade do índice número→tenant e credenciais: D1 central.
 * Este espelho alimenta readiness (AC-14), aviso M-24 e auditoria local.
 * Webhooks/envio ficam em #32/#33.
 */
export const MIGRATION_ID = 6
export const MIGRATION_NAME = '0006_whatsapp_channel'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS whatsapp_channel (
    tenant_id TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('disconnected', 'connected', 'interrupted')
    ),
    binding_id TEXT,
    phone_number_id TEXT,
    waba_id TEXT,
    display_phone TEXT,
    display_name TEXT,
    connected_by TEXT,
    connected_at INTEGER,
    interrupted_at INTEGER,
    interrupt_reason TEXT,
    last_inbound_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS whatsapp_channel_events (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor TEXT,
    phone_number_id TEXT,
    detail_json TEXT,
    occurred_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS whatsapp_channel_events_occurred_idx
    ON whatsapp_channel_events (tenant_id, occurred_at DESC)`,
]
