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
