/**
 * Migração 2 — barreira de autorização local + log de eventos WS (issue #23).
 * Fence e denials no SQLite do DO NÃO concedem acesso; só cortam entrega.
 * Membership vigente continua a ser revalidado no D1 (fail-closed).
 */
export const MIGRATION_ID = 2
export const MIGRATION_NAME = '0002_realtime_fence'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS realtime_fence (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    auth_epoch INTEGER NOT NULL DEFAULT 0,
    tenant_suspended INTEGER NOT NULL DEFAULT 0,
    last_event_seq INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS access_denials (
    clerk_user_id TEXT NOT NULL PRIMARY KEY,
    reason TEXT NOT NULL,
    denied_at INTEGER NOT NULL,
    auth_epoch INTEGER NOT NULL,
    source TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_access_denials_epoch
    ON access_denials (auth_epoch)`,

  `CREATE TABLE IF NOT EXISTS realtime_events (
    seq INTEGER NOT NULL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    UNIQUE (tenant_id, event_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_realtime_events_tenant_seq
    ON realtime_events (tenant_id, seq)`,
]
