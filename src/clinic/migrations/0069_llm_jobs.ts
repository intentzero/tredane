/**
 * DEC-188 / #784 — jobs Claude (extrator/redator) fora do Clinic DO.
 * Snapshot + claim/apply/fail; a fila `tredane-llm-*` chama o AI Gateway.
 */
export const MIGRATION_ID = 69
export const MIGRATION_NAME = '0069_llm_jobs'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS llm_jobs (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('extract', 'redact')),
    state TEXT NOT NULL DEFAULT 'queued'
      CHECK (state IN ('queued', 'claimed', 'done', 'failed', 'stale')),
    idempotency_key TEXT NOT NULL,
    frame_version INTEGER NOT NULL DEFAULT 0,
    snapshot_json TEXT NOT NULL,
    result_json TEXT,
    error_code TEXT,
    claimed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_llm_jobs_conv_msg
    ON llm_jobs (tenant_id, conversation_id, message_id, purpose)`,
  `CREATE INDEX IF NOT EXISTS idx_llm_jobs_state
    ON llm_jobs (tenant_id, state, updated_at)`,
]
