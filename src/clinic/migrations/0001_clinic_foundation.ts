/**
 * Migração 1 — fundação operacional do Clinic DO (issue #20).
 * SQL versionado por instância; distinto das migrations de classe Wrangler.
 * Domínio completo (agenda, pipeline, WhatsApp) chega em F2/F3; aqui só
 * primitivas: meta do tenant, contactos mínimos, inbound/outbox/audit.
 */
export const MIGRATION_ID = 1
export const MIGRATION_NAME = '0001_clinic_foundation'

/** IF NOT EXISTS permite retomar após falha parcial sem reaplicar versão. */
export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS clinic_schema_migrations (
    id INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    applied_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS clinic_schema_state (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ready', 'migrating', 'failed')),
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS clinic_meta (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    tenant_id TEXT NOT NULL UNIQUE,
    bound_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS contacts (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    wa_id TEXT NOT NULL,
    display_name TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, wa_id)
  )`,

  `CREATE TABLE IF NOT EXISTS inbound_events (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    provider_event_key TEXT NOT NULL,
    processing_state TEXT NOT NULL CHECK (
      processing_state IN ('received', 'processed', 'duplicate')
    ),
    payload_json TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, provider_event_key)
  )`,

  `CREATE TABLE IF NOT EXISTS outbox_events (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    processing_state TEXT NOT NULL CHECK (
      processing_state IN ('pending', 'publishing', 'published', 'failed', 'acknowledged')
    ),
    payload_json TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    published_at INTEGER,
    acknowledged_at INTEGER,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, idempotency_key)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox_events (tenant_id, processing_state, occurred_at)`,

  `CREATE TABLE IF NOT EXISTS operational_audit (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    detail_json TEXT,
    occurred_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_operational_audit_time
    ON operational_audit (tenant_id, occurred_at)`,

  // Harness F0: mantém compatibilidade do ping isolado entre instâncias.
  `CREATE TABLE IF NOT EXISTS f0_probe (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
]
