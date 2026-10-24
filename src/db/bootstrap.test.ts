import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const migration0001 = readFileSync(new URL('../../db/migrations/0001_bootstrap.sql', import.meta.url), 'utf8')
const migration0002 = readFileSync(new URL('../../db/migrations/0002_tenant_memberships.sql', import.meta.url), 'utf8')
const seeds = readFileSync(new URL('../../db/seed.sql', import.meta.url), 'utf8')

function bootDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(migration0001)
  db.exec(migration0002)
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

  it('seeds distinct synthetic memberships across two clinics', () => {
    const db = bootDatabase()
    try {
      const memberships = db.prepare(
        `SELECT tenant_id, clerk_user_id, role, status
         FROM tenant_memberships
         ORDER BY tenant_id, clerk_user_id`,
      ).all() as Array<{ tenant_id: string; clerk_user_id: string; role: string; status: string }>

      expect(memberships).toHaveLength(5)
      expect(memberships.every((row) => row.status === 'active')).toBe(true)
      expect(memberships).toEqual(expect.arrayContaining([
        expect.objectContaining({ tenant_id: 'clinic-demo-a', clerk_user_id: 'user_synth_owner_a', role: 'owner' }),
        expect.objectContaining({ tenant_id: 'clinic-demo-a', clerk_user_id: 'user_synth_attendant_a', role: 'attendant' }),
        expect.objectContaining({ tenant_id: 'clinic-demo-a', clerk_user_id: 'user_synth_multi', role: 'owner' }),
        expect.objectContaining({ tenant_id: 'clinic-demo-b', clerk_user_id: 'user_synth_multi', role: 'attendant' }),
        expect.objectContaining({ tenant_id: 'clinic-demo-b', clerk_user_id: 'user_synth_owner_b', role: 'owner' }),
      ]))

      const multi = db.prepare(
        "SELECT tenant_id, role FROM tenant_memberships WHERE clerk_user_id = 'user_synth_multi' ORDER BY tenant_id",
      ).all()
      expect(multi).toEqual([
        { tenant_id: 'clinic-demo-a', role: 'owner' },
        { tenant_id: 'clinic-demo-b', role: 'attendant' },
      ])
    } finally {
      db.close()
    }
  })

  it('rejects memberships for nonexistent tenants', () => {
    const db = bootDatabase()
    try {
      expect(() => db.prepare(
        `INSERT INTO tenant_memberships (tenant_id, clerk_user_id, role, status, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('no-such-tenant', 'user_synth_x', 'owner', 'active', 1)).toThrow()
    } finally {
      db.close()
    }
  })

  it('can re-apply development seeds without duplicates', () => {
    const db = bootDatabase()
    try {
      db.exec(seeds)
      expect(db.prepare('SELECT COUNT(*) AS n FROM tenants').get()).toMatchObject({ n: 2 })
      expect(db.prepare('SELECT COUNT(*) AS n FROM tenant_memberships').get()).toMatchObject({ n: 5 })
    } finally {
      db.close()
    }
  })
})
