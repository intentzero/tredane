/**
 * DEC-148 / T1 — projecção `booking_sessions` no SQLite do Clinic DO.
 * Sessão analítica do funil de marcação (opened / ended); sem texto da cliente.
 */

export const MIGRATION_ID = 56
export const MIGRATION_NAME = '0056_booking_sessions'

export const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS booking_sessions (
    session_id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    outcome TEXT CHECK (
      outcome IS NULL OR outcome IN ('agendado', 'handoff', 'abandon')
    ),
    drop_step TEXT,
    max_step TEXT,
    inbound_turns INTEGER NOT NULL DEFAULT 0,
    flow_used INTEGER NOT NULL DEFAULT 0 CHECK (flow_used IN (0, 1)),
    open_reason TEXT NOT NULL,
    service_id TEXT,
    variant_selection_mode TEXT CHECK (
      variant_selection_mode IS NULL
      OR variant_selection_mode IN ('uma', 'varias')
    )
  )`,
  `CREATE INDEX IF NOT EXISTS idx_booking_sessions_conversation
    ON booking_sessions (tenant_id, conversation_id, opened_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_sessions_one_open
    ON booking_sessions (tenant_id, conversation_id)
    WHERE closed_at IS NULL`,
] as const
