import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ValidationError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import {
  checkSlotAvailabilityOp,
  queryAvailabilityOp,
  zonedCivilToUtc,
} from './index'

const TZ = 'America/Sao_Paulo'
const MONDAY = '2024-01-08'
const TUESDAY = '2024-01-09'

function seedBase(
  db: ReturnType<typeof bootClinicDb>['db'],
  clock: ReturnType<typeof createControllableClock>,
  opts: {
    serviceWindows?: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>
    proWindows?: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>
  } = {},
) {
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Dra. Ana', homeRoomId: room.id },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Consulta',
      durationMinutes: 60,
      bufferMinutes: 0,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
      weeklyWindows: opts.serviceWindows,
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: opts.proWindows ?? [
        { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 },
        { dayOfWeek: 2, startMinute: 9 * 60, endMinute: 18 * 60 },
      ],
    },
    clock,
  )
  return { caller, pro, svc }
}

describe('service weekly offering windows (#261)', () => {
  it('sem faixas no serviço mantém disponibilidade como antes', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, svc } = seedBase(db, clock)
      const result = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: TUESDAY },
        clock,
      )
      expect(result.slots.length).toBeGreaterThan(0)
      const at15 = zonedCivilToUtc(TZ, 2024, 1, 9, 15, 0)
      expect(result.slots.some((s) => s.startsAt === at15)).toBe(true)
    } finally {
      close()
    }
  })

  it('serviço só de manhã bloqueia terça 15:00 mesmo com profissional livre', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, svc } = seedBase(db, clock, {
        serviceWindows: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
          { dayOfWeek: 2, startMinute: 9 * 60, endMinute: 12 * 60 },
          { dayOfWeek: 3, startMinute: 9 * 60, endMinute: 12 * 60 },
          { dayOfWeek: 4, startMinute: 9 * 60, endMinute: 12 * 60 },
          { dayOfWeek: 5, startMinute: 9 * 60, endMinute: 12 * 60 },
        ],
      })
      const avail = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: TUESDAY },
        clock,
      )
      const at15 = zonedCivilToUtc(TZ, 2024, 1, 9, 15, 0)
      expect(avail.slots.some((s) => s.startsAt === at15)).toBe(false)
      expect(avail.slots.at(-1)?.startsAt).toBe(zonedCivilToUtc(TZ, 2024, 1, 9, 11, 0))

      const check = checkSlotAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, professionalId: pro.id, startsAt: at15 },
        clock,
      )
      expect(check.available).toBe(false)
      expect(check.reasons).toContain('outside_weekly_hours')
    } finally {
      close()
    }
  })

  it('rejeita faixas sobrepostas no mesmo dia ao gravar serviço', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const pro = upsertResourceOp(
        db,
        caller,
        { kind: 'professional', name: 'Dra. Ana' },
        clock,
      )
      expect(() =>
        upsertServiceOp(
          db,
          caller,
          {
            name: 'Overlap',
            durationMinutes: 30,
            bufferMinutes: 0,
            professionalIds: [pro.id],
            weeklyWindows: [
              { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
              { dayOfWeek: 1, startMinute: 11 * 60, endMinute: 13 * 60 },
            ],
          },
          clock,
        ),
      ).toThrow(ValidationError)
    } finally {
      close()
    }
  })

  it('intersecta com expediente da profissional (manhã do serviço ∩ tarde dela = vazio)', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, svc } = seedBase(db, clock, {
        serviceWindows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 }],
        proWindows: [{ dayOfWeek: 1, startMinute: 14 * 60, endMinute: 18 * 60 }],
      })
      const avail = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: MONDAY },
        clock,
      )
      expect(avail.slots).toHaveLength(0)
    } finally {
      close()
    }
  })
})
