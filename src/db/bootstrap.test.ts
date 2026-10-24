import { describe, expect, it } from 'vitest'
import { ADMIN_SCHEMA_VERSION } from './admin/constants'
import {
  applyRemainingFromAdmin,
  bootAdminDb,
  migrateEmpty,
  migrateUntilMemberships,
  openMemoryDb,
  seedDb,
} from './test-db'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { MIGRATIONS_DIR } from './test-db'

describe('D1-compatible bootstrap SQL', () => {
  it('loads fictional tenants, legacy fixtures and expanded memberships', () => {
    const { raw, close } = bootAdminDb()
    try {
      const tenants = raw.prepare('SELECT id, status FROM tenants ORDER BY id').all() as Array<{
        id: string
        status: string
      }>
      expect(tenants.map((row) => row.id)).toEqual([
        'clinic-demo-a',
        'clinic-demo-b',
        'clinic-demo-suspended',
      ])
      expect(tenants.find((t) => t.id === 'clinic-demo-suspended')?.status).toBe('suspended')
      expect(raw.prepare('SELECT COUNT(*) AS n FROM services').get()).toMatchObject({ n: 3 })
      expect(raw.prepare('SELECT COUNT(*) AS n FROM professionals').get()).toMatchObject({ n: 3 })
      expect(raw.prepare('SELECT COUNT(*) AS n FROM tenant_memberships').get()).toMatchObject({ n: 7 })
      expect(raw.prepare('SELECT version FROM admin_schema_state WHERE id = 1').get()).toMatchObject({
        version: ADMIN_SCHEMA_VERSION,
      })
    } finally {
      close()
    }
  })

  it('rejects records for nonexistent tenants and preserves per-tenant IDs', () => {
    const { raw, close } = bootAdminDb()
    try {
      expect(() => raw.prepare(
        'INSERT INTO services (id, tenant_id, name, duration_minutes) VALUES (?, ?, ?, ?)',
      ).run('invalid', 'no-such-tenant', 'Never saved', 30)).toThrow()

      const rows = raw.prepare(
        "SELECT tenant_id FROM professionals WHERE id = 'prof-1' ORDER BY tenant_id",
      ).all()
      expect(rows.map((row) => (row as { tenant_id: string }).tenant_id)).toEqual([
        'clinic-demo-a',
        'clinic-demo-b',
        'clinic-demo-suspended',
      ])
    } finally {
      close()
    }
  })

  it('seeds N:N multi-owner and user without access', () => {
    const { raw, close } = bootAdminDb()
    try {
      const multi = raw.prepare(
        "SELECT tenant_id, role FROM tenant_memberships WHERE clerk_user_id = 'user_synth_multi' ORDER BY tenant_id",
      ).all()
      expect(multi).toEqual([
        { tenant_id: 'clinic-demo-a', role: 'owner' },
        { tenant_id: 'clinic-demo-b', role: 'attendant' },
      ])

      const ownersA = raw.prepare(
        `SELECT clerk_user_id FROM tenant_memberships
         WHERE tenant_id = 'clinic-demo-a' AND role = 'owner' AND status = 'active'
         ORDER BY clerk_user_id`,
      ).all() as Array<{ clerk_user_id: string }>
      expect(ownersA.map((r) => r.clerk_user_id)).toEqual([
        'user_synth_multi',
        'user_synth_owner_a',
        'user_synth_owner_a2',
      ])

      const noAccess = raw.prepare(
        "SELECT COUNT(*) AS n FROM tenant_memberships WHERE clerk_user_id = 'user_synth_no_access'",
      ).get() as { n: number }
      expect(noAccess.n).toBe(0)
    } finally {
      close()
    }
  })

  it('can re-apply development seeds without duplicates', () => {
    const { raw, close } = bootAdminDb()
    try {
      seedDb(raw)
      expect(raw.prepare('SELECT COUNT(*) AS n FROM tenants').get()).toMatchObject({ n: 3 })
      expect(raw.prepare('SELECT COUNT(*) AS n FROM tenant_memberships').get()).toMatchObject({ n: 7 })
    } finally {
      close()
    }
  })
})

describe('migration parity empty vs baseline upgrade', () => {
  it('empty DB and upgrade from 0002 produce the same schema fingerprint', () => {
    const empty = openMemoryDb()
    const upgraded = openMemoryDb()
    try {
      migrateEmpty(empty)
      migrateUntilMemberships(upgraded)
      applyRemainingFromAdmin(upgraded)

      const fingerprint = (db: typeof empty) => {
        const tables = db.prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        ).all() as Array<{ name: string }>
        const parts: string[] = []
        for (const { name } of tables) {
          const cols = db.prepare(`PRAGMA table_info('${name.replaceAll("'", "''")}')`).all() as Array<{
            name: string
            type: string
            notnull: number
            dflt_value: unknown
            pk: number
          }>
          parts.push(`T:${name}`)
          for (const c of cols) {
            parts.push(`C:${name}.${c.name}:${c.type}:${c.notnull}:${c.pk}:${c.dflt_value}`)
          }
          const indexes = db.prepare(`PRAGMA index_list('${name.replaceAll("'", "''")}')`).all() as Array<{
            name: string
            unique: number
          }>
          for (const idx of indexes.sort((a, b) => a.name.localeCompare(b.name))) {
            parts.push(`I:${idx.name}:u${idx.unique}`)
          }
        }
        return createHash('sha256').update(parts.join('|')).digest('hex')
      }

      expect(fingerprint(empty)).toEqual(fingerprint(upgraded))
      expect(empty.prepare('SELECT version FROM admin_schema_state WHERE id = 1').get()).toMatchObject({
        version: ADMIN_SCHEMA_VERSION,
      })
      expect(upgraded.prepare('SELECT version FROM admin_schema_state WHERE id = 1').get()).toMatchObject({
        version: ADMIN_SCHEMA_VERSION,
      })
    } finally {
      empty.close()
      upgraded.close()
    }
  })

  it('drizzle journal tags match SQL migration files', () => {
    const journal = JSON.parse(
      readFileSync(new URL('../../db/migrations/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: Array<{ tag: string }> }
    const sqlFiles = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort()
    const tags = journal.entries.map((e) => `${e.tag}.sql`).sort()
    expect(tags).toEqual(sqlFiles)
  })
})
