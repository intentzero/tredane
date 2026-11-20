import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { CLINIC_MIGRATIONS } from '../migrations'
import { bootClinicDb } from '../test-db'

describe('migração 0080_client_web_rr_cursor', () => {
  it('regista id 80 e sobe o alvo do schema', () => {
    expect(CLINIC_SCHEMA_VERSION).toBe(80)
    const m = CLINIC_MIGRATIONS.find((x) => x.id === 80)
    expect(m?.name).toBe('0080_client_web_rr_cursor')
    expect(m?.statements.some((s) => s.includes('client_web_rr_cursor'))).toBe(true)
  })

  it('boot cria a tabela de cursor de rodízio', () => {
    const clock = createControllableClock(Date.UTC(2026, 10, 20))
    const { db, close } = bootClinicDb({ clock })
    try {
      const state = db.get<{ version: number; status: string }>(
        'SELECT version, status FROM clinic_schema_state WHERE id = 1',
      )
      expect(state).toEqual({ version: 80, status: 'ready' })
      const row = db.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'client_web_rr_cursor'`,
      )
      expect(row?.name).toBe('client_web_rr_cursor')
    } finally {
      close()
    }
  })
})
