import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { applyAllMigrations, applySqlFile } from './apply-migrations'
import { fromNodeSqlite, type AdminDb } from './admin/store'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const MIGRATIONS_DIR = join(root, 'db/migrations')
export const SEED_PATH = join(root, 'db/seed.sql')

export function openMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  return db
}

export function migrateEmpty(db: DatabaseSync): string[] {
  return applyAllMigrations((sql) => db.exec(sql), MIGRATIONS_DIR)
}

/** Baseline F0 (0001+0002) sem a migração administrativa. */
export function migrateUntilMemberships(db: DatabaseSync): string[] {
  return applyAllMigrations((sql) => db.exec(sql), MIGRATIONS_DIR, {
    untilInclusive: '0002_tenant_memberships',
  })
}

export function applyRemainingFromAdmin(db: DatabaseSync): void {
  applySqlFile((sql) => db.exec(sql), join(MIGRATIONS_DIR, '0003_admin_d1_central.sql'))
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0004_platform_admin_lifecycle.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0005_email_delivery_jobs.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0006_support_request_email.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0007_support_session_email.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0008_whatsapp_bindings.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0009_whatsapp_webhook_receipts.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0010_webhook_receipt_media_kind.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0011_pix_webhook_receipts.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0012_push_subscriptions.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0013_tenant_purge.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0014_webhook_receipt_button_reply.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0015_invitation_owner_role.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0016_webhook_receipt_list_reply.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0017_whatsapp_flow_tokens.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0018_whatsapp_flow_session.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0019_whatsapp_flow_opened_at.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0020_review_samples.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0021_review_sample_client_comment.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0022_review_sample_client_comments.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0023_interpreter_shadow_events.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0024_conversation_quality.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0025_tenant_health_summary.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0026_tenant_health_volume.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0027_client_web.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0028_client_web_rate_limits.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0029_support_token_hash_ended.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0030_client_web_link_service.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0031_drop_interpreter_shadow_events.sql'),
  )
  applySqlFile(
    (sql) => db.exec(sql),
    join(MIGRATIONS_DIR, '0032_client_web_link_line.sql'),
  )
}

export function seedDb(db: DatabaseSync): void {
  db.exec(readFileSync(SEED_PATH, 'utf8'))
}

export function bootAdminDb(opts: { seed?: boolean } = {}): {
  raw: DatabaseSync
  db: AdminDb
  close: () => void
} {
  const raw = openMemoryDb()
  migrateEmpty(raw)
  if (opts.seed !== false) seedDb(raw)
  return {
    raw,
    db: fromNodeSqlite(raw),
    close: () => raw.close(),
  }
}
