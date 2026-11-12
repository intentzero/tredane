import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { zonedCivilToUtc } from './timezone'
import { queryAvailabilityOp } from './index'

const TZ = 'America/Sao_Paulo'

describe('bookingLeadMinutes', () => {
  it('default 30 min corta slots antes de agora+30', () => {
    const at = zonedCivilToUtc(TZ, 2026, 11, 12, 10, 41)
    const clock = createControllableClock(at)
    const boot = bootClinicDb({ clock })
    const caller = workerCaller('clinic-demo-lead', 'user_synth_owner_a')
    const room = upsertResourceOp(boot.db, caller, { kind: 'room', name: 'Sala' }, clock)
    const pro = upsertResourceOp(boot.db, caller, { kind: 'professional', name: 'P', homeRoomId: room.id }, clock)
    const week = [4].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 }))
    setWeeklyWindowsOp(boot.db, caller, { resourceId: pro.id, windows: week }, clock)
    setWeeklyWindowsOp(boot.db, caller, { resourceId: room.id, windows: week }, clock)
    const svc = upsertServiceOp(
      boot.db,
      caller,
      {
        name: 'Massagem',
        durationMinutes: 60,
        bufferMinutes: 0,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    try {
      const slots = queryAvailabilityOp(boot.db, caller, { serviceId: svc.id, date: '2026-11-12' }, clock)
        .slots
        .map((s) => s.startsAt)
      expect(slots).not.toContain(zonedCivilToUtc(TZ, 2026, 11, 12, 10, 45))
      expect(slots.some((t) => t >= zonedCivilToUtc(TZ, 2026, 11, 12, 11, 15))).toBe(true)
    } finally {
      boot.close()
    }
  })
})
