import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(new URL('../../db/migrations/0001_bootstrap.sql', import.meta.url), 'utf8')
const seeds = readFileSync(new URL('../../db/seed.sql', import.meta.url), 'utf8')

function bootDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(migration)
  db.exec(seeds)
  return db
}

describe('D1-compatible bootstrap SQL', () => {
  it('loads exactly two fictional tenants and their isolated fixtures', () => {
    const db = bootDatabase()
    try {
      const tenants = db.prepare('SELECT id FROM tenants ORDER BY id').all()
      expect(tenants.map((row) => row.id)).toEqual(['clinic-demo-a', 'clinic-demo-b'])
      expect(db.prepare('SELECT COUNT(*) AS n FROM services').get()).toMatchObject({ n: 2 })
      expect(db.prepare('SELECT COUNT(*) AS n FROM professionals').get()).toMatchObject({ n: 2 })
    } finally {
      db.close()
    }
  })

  it('rejects records for nonexistent tenants and preserves per-tenant IDs', () => {
    const db = bootDatabase()
    try {
      expect(() => db.prepare(
        'INSERT INTO services (id, tenant_id, name, duration_minutes) VALUES (?, ?, ?, ?)',
      ).run('invalid', 'no-such-tenant', 'Never saved', 30)).toThrow()

      const rows = db.prepare(
        "SELECT tenant_id FROM professionals WHERE id = 'prof-1' ORDER BY tenant_id",
      ).all()
      expect(rows.map((row) => row.tenant_id)).toEqual(['clinic-demo-a', 'clinic-demo-b'])
    } finally {
      db.close()
    }
  })

  it('can re-apply development seeds without duplicates', () => {
    const db = bootDatabase()
    try {
      db.exec(seeds)
      expect(db.prepare('SELECT COUNT(*) AS n FROM tenants').get()).toMatchObject({ n: 2 })
    } finally {
      db.close()
    }
  })
})
