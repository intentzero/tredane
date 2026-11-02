/**
 * Upgrade fixture schema 48 → 49 (ADR-0015 / #412 M2).
 */
import { describe, expect, it } from 'vitest'
import { systemClock } from '../../db/clock'
import { getBookingFrame } from '../ai/schedule-session'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { CLINIC_MIGRATIONS, runClinicMigrations } from '../migrations'
import { fromNodeSqlite } from '../store'
import { openClinicMemoryDb } from '../test-db'

function migrateThrough(db: ReturnType<typeof fromNodeSqlite>, maxId: number) {
  for (const m of CLINIC_MIGRATIONS.filter((x) => x.id <= maxId)) {
    for (const st of m.statements) db.exec(st)
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS clinic_schema_migrations (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS clinic_schema_state (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ready', 'migrating', 'failed')),
      updated_at INTEGER NOT NULL
    )
  `)
  db.run(
    `INSERT INTO clinic_schema_state (id, version, status, updated_at) VALUES (1, ?, 'ready', 0)
     ON CONFLICT(id) DO UPDATE SET version = excluded.version, status = 'ready'`,
    maxId,
  )
}

function seedConversation(db: ReturnType<typeof fromNodeSqlite>) {
  db.run(
    `INSERT INTO contacts (id, tenant_id, wa_id, display_name, created_at)
     VALUES ('c1', 't', '5511999000111', 'Cliente', 0)`,
  )
  db.run(
    `INSERT INTO conversations (
       id, tenant_id, contact_id, status, assignment_version, unread_count, created_at, updated_at
     ) VALUES ('cv1', 't', 'c1', 'open', 0, 0, 0, 0)`,
  )
}

describe('migração 0049 BookingFrame', () => {
  it('CLINIC_SCHEMA_VERSION sobe para 49', () => {
    expect(CLINIC_SCHEMA_VERSION).toBe(49)
    expect(CLINIC_MIGRATIONS.some((m) => m.id === 49 && m.name === '0049_booking_frame')).toBe(
      true,
    )
  })

  it('upgrade a partir do schema 48: só serviço → date NULL, resto ok', () => {
    const raw = openClinicMemoryDb()
    const db = fromNodeSqlite(raw)
    try {
      migrateThrough(db, 48)
      seedConversation(db)
      db.run(
        `INSERT INTO schedule_sessions (
           tenant_id, conversation_id, service_id, audience_line, day_label, period,
           variant_ids, clock_time, updated_at
         ) VALUES ('t', 'cv1', 'svc1', NULL, NULL, NULL, NULL, NULL, 1)`,
      )

      const m49 = CLINIC_MIGRATIONS.find((x) => x.id === 49)!
      for (const st of m49.statements) db.exec(st)
      db.run(`UPDATE clinic_schema_state SET version = 49 WHERE id = 1`)

      const row = db.get<{
        date: string | null
        line: string | null
        time: string | null
        phase: string | null
        day_label: string | null
        service_id: string
      }>(
        `SELECT date, line, time, phase, day_label, service_id FROM schedule_sessions
         WHERE tenant_id = 't' AND conversation_id = 'cv1'`,
      )
      expect(row).toMatchObject({
        service_id: 'svc1',
        date: null,
        line: null,
        time: null,
        phase: 'coletando',
      })
      expect(row?.day_label ?? null).toBeNull()

      const frame = getBookingFrame(db, 't', 'cv1')
      expect(frame?.serviceId).toBe('svc1')
      expect(frame?.date).toBeNull()
    } finally {
      raw.close()
    }
  })

  it('upgrade 48: serviço+linha+variantes+período+hora com day_label=amanhã → date NULL resto ok', () => {
    const raw = openClinicMemoryDb()
    const db = fromNodeSqlite(raw)
    try {
      migrateThrough(db, 48)
      seedConversation(db)
      db.run(
        `INSERT INTO schedule_sessions (
           tenant_id, conversation_id, service_id, audience_line, day_label, period,
           variant_ids, clock_time, updated_at
         ) VALUES ('t', 'cv1', 'svc1', 'feminino', 'amanhã', 'tarde', ?, '14:00', 1)`,
        JSON.stringify(['z1', 'z2']),
      )

      const m49 = CLINIC_MIGRATIONS.find((x) => x.id === 49)!
      for (const st of m49.statements) db.exec(st)

      const row = db.get<{
        date: string | null
        line: string | null
        time: string | null
        period: string | null
        variant_ids: string | null
        day_label: string | null
        audience_line: string | null
      }>(
        `SELECT date, line, time, period, variant_ids, day_label, audience_line
         FROM schedule_sessions WHERE tenant_id = 't' AND conversation_id = 'cv1'`,
      )
      expect(row).toMatchObject({
        date: null,
        line: 'feminino',
        time: '14:00',
        period: 'tarde',
        audience_line: 'feminino',
      })
      expect(JSON.parse(row!.variant_ids!)).toEqual(['z1', 'z2'])
      expect(row?.day_label).toBe('amanhã')

      const frame = getBookingFrame(db, 't', 'cv1')
      expect(frame).toMatchObject({
        serviceId: 'svc1',
        line: 'feminino',
        date: null,
        period: 'tarde',
        time: '14:00',
        variantIds: ['z1', 'z2'],
      })
    } finally {
      raw.close()
    }
  })

  it('upgrade 48: conversa sem sessão → sem linha de frame', () => {
    const raw = openClinicMemoryDb()
    const db = fromNodeSqlite(raw)
    try {
      migrateThrough(db, 48)
      seedConversation(db)
      const m49 = CLINIC_MIGRATIONS.find((x) => x.id === 49)!
      for (const st of m49.statements) db.exec(st)
      const n = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM schedule_sessions`)
      expect(n?.n).toBe(0)
      expect(getBookingFrame(db, 't', 'cv1')).toBeNull()
    } finally {
      raw.close()
    }
  })

  it('runClinicMigrations sobe 0→49 e é no-op na segunda vez', () => {
    const raw = openClinicMemoryDb()
    const db = fromNodeSqlite(raw)
    try {
      const r1 = runClinicMigrations(db, systemClock)
      expect(r1.toVersion).toBe(49)
      expect(r1.applied).toContain('0049_booking_frame')
      const r2 = runClinicMigrations(db, systemClock)
      expect(r2.status).toBe('already_ready')
      expect(r2.applied).toEqual([])
    } finally {
      raw.close()
    }
  })
})
