import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { workerCaller } from '../clinic'
import { bootClinicDb } from '../clinic/test-db'
import { isClientWebEnabledForClinic, readClientWebSetting, setClientWebEnabledOp } from './settings'

describe('interruptor da owner (DEC-199)', () => {
  it('começa desligado e só liga quando a owner liga; fica na auditoria', () => {
    const clock = createControllableClock(Date.UTC(2026, 10, 17, 15))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      expect(isClientWebEnabledForClinic(db, 'clinic-demo-a')).toBe(false)
      expect(readClientWebSetting(db, 'clinic-demo-a')).toEqual({ enabled: false, updatedAt: null })

      expect(setClientWebEnabledOp(db, caller, { enabled: true }, clock).enabled).toBe(true)
      expect(isClientWebEnabledForClinic(db, 'clinic-demo-a')).toBe(true)
      expect(setClientWebEnabledOp(db, caller, { enabled: false }, clock).enabled).toBe(false)
      expect(isClientWebEnabledForClinic(db, 'clinic-demo-a')).toBe(false)

      const audit = db.all("SELECT actor, detail_json FROM operational_audit WHERE action = 'config.client_web_updated' ORDER BY rowid") as Array<{ actor: string; detail_json: string }>
      expect(audit.map((a) => JSON.parse(a.detail_json))).toEqual([{ before: false, after: true }, { before: true, after: false }])
      expect(audit[0]!.actor).toBe('user_synth_owner_a')
    } finally {
      close()
    }
  })

  it('é por clínica: outra clínica não é afetada', () => {
    const clock = createControllableClock(Date.UTC(2026, 10, 17, 15))
    const { db, close } = bootClinicDb({ clock })
    try {
      setClientWebEnabledOp(db, workerCaller('clinic-demo-a', 'user_synth_owner_a'), { enabled: true }, clock)
      expect(isClientWebEnabledForClinic(db, 'clinic-outra')).toBe(false)
    } finally {
      close()
    }
  })
})
