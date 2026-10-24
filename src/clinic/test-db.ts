import { DatabaseSync } from 'node:sqlite'
import { systemClock, type Clock } from '../db/clock'
import { fromNodeSqlite, type ClinicDb } from './store'
import { runClinicMigrations } from './migrations'

export function openClinicMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  return db
}

export function bootClinicDb(opts: { clock?: Clock; migrate?: boolean } = {}): {
  raw: DatabaseSync
  db: ClinicDb
  clock: Clock
  close: () => void
} {
  const raw = openClinicMemoryDb()
  const db = fromNodeSqlite(raw)
  const clock = opts.clock ?? systemClock
  if (opts.migrate !== false) {
    runClinicMigrations(db, clock)
  }
  return {
    raw,
    db,
    clock,
    close: () => raw.close(),
  }
}
