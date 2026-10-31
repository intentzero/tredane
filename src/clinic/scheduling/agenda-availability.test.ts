/**
 * A Agenda devolve expediente, livres e bloqueios por profissional e dia
 * (TEL-04). Fuso America/Sao_Paulo, relógio injetável.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { createBlockOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { confirmAppointmentOp, queryAgendaViewOp, zonedCivilToUtc } from './index'

const TZ = 'America/Sao_Paulo'
// Segunda 09/11/2026.
const mon = (h: number, m = 0) => zonedCivilToUtc(TZ, 2026, 11, 9, h, m)

function seed(now: number) {
  const clock = createControllableClock(now)
  const boot = bootClinicDb({ clock })
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const pro = upsertResourceOp(boot.db, caller, { kind: 'professional', name: 'Gi' }, clock)
  const idle = upsertResourceOp(boot.db, caller, { kind: 'professional', name: 'Ana' }, clock)
  const windows = [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 }]
  setWeeklyWindowsOp(boot.db, caller, { resourceId: pro.id, windows }, clock)
  setWeeklyWindowsOp(boot.db, caller, { resourceId: idle.id, windows: [] }, clock)
  const svc = upsertServiceOp(
    boot.db,
    caller,
    { name: 'Limpeza', durationMinutes: 60, bufferMinutes: 0, professionalIds: [pro.id], roomRequirement: { mode: 'none' } },
    clock,
  )
  const agenda = (view: 'day' | 'week', professionalId?: string) =>
    queryAgendaViewOp(boot.db, caller, { date: '2026-11-09', view, professionalId }, clock)
  return { ...boot, clock, caller, pro, idle, svc, agenda }
}

describe('Agenda — expediente, livres e bloqueios', () => {
  it('dia: expediente, ocupação e blocos livres da profissional', () => {
    const s = seed(mon(7))
    try {
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'a-1',
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          startsAt: mon(10),
          actorClerkUserId: 'user_synth_owner_a',
        },
        s.clock,
      )
      const gi = s.agenda('day').availability.find((p) => p.professionalId === s.pro.id)!
      expect(gi.days).toHaveLength(1)
      const day = gi.days[0]!
      expect(day.openMinutes).toBe(480)
      expect(day.busyMinutes).toBe(60)
      expect(day.windows).toEqual([{ startsAt: mon(9), endsAt: mon(17) }])
      expect(day.free).toEqual([
        { startsAt: mon(9), endsAt: mon(10) },
        { startsAt: mon(11), endsAt: mon(17) },
      ])
      const ana = s.agenda('day').availability.find((p) => p.professionalId === s.idle.id)!
      expect(ana.days[0]!.openMinutes).toBe(0)
      expect(ana.days[0]!.free).toEqual([])
    } finally {
      s.close()
    }
  })

  it('já passou não é livre; bloqueio da clínica tira o trecho e aparece com escopo', () => {
    const s = seed(mon(11, 50))
    try {
      createBlockOp(
        s.db,
        s.caller,
        { resourceId: '__clinic__', startsAt: mon(14), endsAt: mon(15), reason: 'feriado' },
        s.clock,
      )
      const day = s.agenda('day').availability.find((p) => p.professionalId === s.pro.id)!.days[0]!
      expect(day.free).toEqual([
        { startsAt: mon(12), endsAt: mon(14) },
        { startsAt: mon(15), endsAt: mon(17) },
      ])
      expect(day.blocks).toEqual([
        expect.objectContaining({ startsAt: mon(14), endsAt: mon(15), reason: 'feriado', scope: 'clinic' }),
      ])
      expect(day.busyMinutes).toBe(60)
    } finally {
      s.close()
    }
  })

  it('semana traz sete dias e o filtro por profissional é respeitado', () => {
    const s = seed(mon(7))
    try {
      const week = s.agenda('week')
      expect(week.availability.map((p) => p.professionalName)).toEqual(['Ana', 'Gi'])
      expect(week.availability[0]!.days.map((d) => d.date)).toEqual([
        '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15',
      ])
      const only = s.agenda('week', s.pro.id)
      expect(only.availability.map((p) => p.professionalId)).toEqual([s.pro.id])
      expect(only.availability[0]!.days[1]!.openMinutes).toBe(0)
    } finally {
      s.close()
    }
  })
})
