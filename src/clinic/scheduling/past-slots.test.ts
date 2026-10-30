/**
 * Horários cujo início já passou não são oferecidos nem marcados
 * (OK do Paulo, 28/10/2026). Fuso America/Sao_Paulo, relógio injetável.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { buildClinicAiContext } from '../ai/schedule-context'
import { checkSlotAvailabilityOp, queryAvailabilityOp, zonedCivilToUtc } from './index'

const TZ = 'America/Sao_Paulo'
// Segunda 09/11/2026 e terça 10/11/2026.
const mon = (h: number, m = 0) => zonedCivilToUtc(TZ, 2026, 11, 9, h, m)
const tue = (h: number, m = 0) => zonedCivilToUtc(TZ, 2026, 11, 10, h, m)

function seed(now: number, windows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>, duration = 60) {
  const clock = createControllableClock(now)
  const boot = bootClinicDb({ clock })
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const pro = upsertResourceOp(boot.db, caller, { kind: 'professional', name: 'Gi' }, clock)
  setWeeklyWindowsOp(boot.db, caller, { resourceId: pro.id, windows }, clock)
  // No main a agenda só fica configurada com uma sala com expediente.
  const room = upsertResourceOp(boot.db, caller, { kind: 'room', name: 'Sala 1' }, clock)
  setWeeklyWindowsOp(boot.db, caller, { resourceId: room.id, windows }, clock)
  const svc = upsertServiceOp(
    boot.db,
    caller,
    { name: 'Limpeza', durationMinutes: duration, bufferMinutes: 0, professionalIds: [pro.id], roomRequirement: { mode: 'none' } },
    clock,
  )
  const starts = (date: string) =>
    queryAvailabilityOp(boot.db, caller, { serviceId: svc.id, date }, clock).slots.map((x) => x.startsAt)
  const check = (startsAt: number) =>
    checkSlotAvailabilityOp(boot.db, caller, { serviceId: svc.id, professionalId: pro.id, startsAt }, clock)
  return { ...boot, clock, caller, pro, svc, starts, check }
}

const WEEK = [1, 2].map((d) => ({ dayOfWeek: d, startMinute: 9 * 60, endMinute: 17 * 60 }))

describe('horários que já passaram', () => {
  it('hoje: horários já iniciados são cortados (mesmo que ainda não terminaram)', () => {
    const s = seed(mon(11, 50), WEEK)
    try {
      const st = s.starts('2026-11-09')
      expect(Math.min(...st)).toBe(mon(12))
      expect(st).not.toContain(mon(11, 45))
      expect(st).not.toContain(mon(11))
      expect(Math.max(...st)).toBe(mon(16))
      const past = s.check(mon(11, 45))
      expect(past.available).toBe(false)
      expect(past.reasons).toContain('past_slot')
      expect(s.check(mon(12)).available).toBe(true)
    } finally {
      s.close()
    }
  })

  it('horário que começa exatamente agora continua disponível', () => {
    const s = seed(mon(12), WEEK)
    try {
      expect(Math.min(...s.starts('2026-11-09'))).toBe(mon(12))
      expect(s.check(mon(12)).available).toBe(true)
    } finally {
      s.close()
    }
  })

  it('dias futuros ficam intactos', () => {
    const s = seed(mon(16, 30), WEEK)
    try {
      expect(s.starts('2026-11-09')).toHaveLength(0)
      const st = s.starts('2026-11-10')
      expect(Math.min(...st)).toBe(tue(9))
      expect(Math.max(...st)).toBe(tue(16))
    } finally {
      s.close()
    }
  })

  it('fronteira de dia em BRT: 23:30 BRT = 02:30 UTC do dia seguinte', () => {
    const now = mon(23, 30)
    expect(new Date(now).toISOString()).toBe('2026-11-10T02:30:00.000Z')
    const s = seed(
      now,
      [
        { dayOfWeek: 1, startMinute: 22 * 60, endMinute: 24 * 60 },
        { dayOfWeek: 2, startMinute: 8 * 60, endMinute: 10 * 60 },
      ],
      15,
    )
    try {
      expect(s.starts('2026-11-09')).toEqual([mon(23, 30), mon(23, 45)])
      const st = s.starts('2026-11-10')
      expect(Math.min(...st)).toBe(tue(8))
      expect(st).toHaveLength(8)
    } finally {
      s.close()
    }
  })

  it('a IA não recebe horários que já começaram', async () => {
    const s = seed(mon(11, 50), WEEK)
    try {
      const ctx = await buildClinicAiContext(s.db, 'clinic-demo-a', s.clock, { contactId: 'c-none', recentTexts: [] })
      const today = ctx.freeSlots.find((d) => d.date === '2026-11-09')
      expect(today).toBeTruthy()
      expect(today!.times.length).toBeGreaterThan(0)
      for (const t of today!.times) expect(t >= '12:00').toBe(true)
    } finally {
      s.close()
    }
  })
})
