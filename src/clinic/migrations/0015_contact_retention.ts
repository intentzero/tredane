/**
 * Migração 15 — retenção/exclusão (#43 / REQ-071 / DEC-011):
 * tombstones de contacto (anti-reintrodução) + estado local de expurgo.
 */
export const MIGRATION_ID = 15
export const MIGRATION_NAME = '0015_contact_retention'

export const STATEMENTS: readonly string[] = [
  /**
   * Tombstone por wa_id (DEC-099): enquanto existir, o upsert directo não
   * recria o contacto. Uma mensagem nova (evento de provedor ainda não
   * gravado) limpa esta linha e abre contacto limpo. O replay do evento já
   * gravado fica em inbound_events, que a exclusão do contacto não apaga.
   */
  `CREATE TABLE IF NOT EXISTS contact_deletion_tombstones (
    tenant_id TEXT NOT NULL,
    wa_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    deleted_at INTEGER NOT NULL,
    deleted_by_clerk_user_id TEXT,
    PRIMARY KEY (tenant_id, wa_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_contact_tombstones_contact
    ON contact_deletion_tombstones (tenant_id, contact_id)`,

  /**
   * Checkpoint local do wipe SQLite do DO (passo clinic_sqlite_wiped do expurgo).
   * Sem PHI — só estado do processo.
   */
  `CREATE TABLE IF NOT EXISTS clinic_purge_state (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    status TEXT NOT NULL CHECK (
      status IN ('idle', 'wiping', 'wiped', 'failed')
    ),
    last_step TEXT,
    updated_at INTEGER NOT NULL,
    wiped_at INTEGER
  )`,

  `INSERT OR IGNORE INTO clinic_purge_state (id, status, last_step, updated_at, wiped_at)
   VALUES (1, 'idle', NULL, 0, NULL)`,
]
