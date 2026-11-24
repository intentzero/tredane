import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { ensureClinicSettings } from '../config/settings'
import { zonedCivilToUtc } from './timezone'
import { checkSlotAvailabilityOp, queryAvailabilityOp } from './index'

const TZ = 'America/Sao_Paulo'

describe('bookingLeadMinutes', () => {
  it('com 30 min corta slots antes de agora+30', () => {
    const at = zonedCivilToUtc(TZ, 2026, 11, 12, 10, 41)
    const clock = createControllableClock(at)
    const boot = bootClinicDb({ clock })
    const caller = workerCaller('clinic-demo-lead', 'user_synth_owner_a')
    ensureClinicSettings(boot.db, caller.tenantId, clock)
    // DEC-182: padrão de produto é Desligado (0); este caso fixa 30 min.
    boot.db.run(`UPDATE clinic_settings SET booking_lead_minutes = 30 WHERE id = 1`)
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

      // DEC-227: a equipe no painel ignora a antecedência, mas nunca o passado.
      const staff = queryAvailabilityOp(
        boot.db,
        caller,
        { serviceId: svc.id, date: '2026-11-12', applyBookingLead: false },
        clock,
      ).slots.map((s) => s.startsAt)
      expect(staff).toContain(zonedCivilToUtc(TZ, 2026, 11, 12, 10, 45))
      expect(staff).not.toContain(zonedCivilToUtc(TZ, 2026, 11, 12, 10, 30))

      const within = zonedCivilToUtc(TZ, 2026, 11, 12, 10, 45)
      const checkInput = { serviceId: svc.id, professionalId: pro.id, startsAt: within }
      expect(checkSlotAvailabilityOp(boot.db, caller, checkInput, clock).reasons).toContain('past_slot')
      expect(
        checkSlotAvailabilityOp(boot.db, caller, { ...checkInput, applyBookingLead: false }, clock).available,
      ).toBe(true)
    } finally {
      boot.close()
    }
  })
})
