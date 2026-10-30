import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { NotFoundError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  createBlockOp,
  insertSyntheticAppointment,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import {
  checkSlotAvailabilityOp,
  clinicDayBounds,
  clinicDayOfWeek,
  queryAvailabilityOp,
  zonedCivilToUtc,
} from './index'

const TZ = 'America/Sao_Paulo'

/**
 * Segunda-feira 2024-01-08 em America/Sao_Paulo (UTC-3, sem DST).
 * dayOfWeek = 1.
 */
const MONDAY = '2024-01-08'

function seedClinic(
  db: ReturnType<typeof bootClinicDb>['db'],
  clock: ReturnType<typeof createControllableClock>,
  opts: {
    tenantId?: string
    duration?: number
    buffer?: number
    proWindows?: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>
    roomWindows?: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>
  } = {},
) {
  const tenantId = opts.tenantId ?? 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  const room = upsertResourceOp(
    db,
    caller,
    { kind: 'room', name: 'Sala 2', category: 'Sala com laser' },
    clock,
  )
  const roomB = upsertResourceOp(
    db,
    caller,
    { kind: 'room', name: 'Sala 3', category: 'Sala com laser' },
    clock,
  )
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Dra. Paula Reis', homeRoomId: room.id },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação a laser — pernas',
      durationMinutes: opts.duration ?? 60,
      bufferMinutes: opts.buffer ?? 15,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: opts.proWindows ?? [
        { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
      ],
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: room.id,
      windows: opts.roomWindows ?? [
        { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 },
      ],
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: roomB.id,
      windows: opts.roomWindows ?? [
        { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 },
      ],
    },
    clock,
  )
  return { caller, pro, room, roomB, svc }
}

describe('timezone helpers (#35)', () => {
  it('converte limites do dia e weekday no fuso da clínica', () => {
    const { dayStartsAt, dayEndsAt } = clinicDayBounds(TZ, MONDAY)
    expect(clinicDayOfWeek(TZ, dayStartsAt)).toBe(1)
    // 2024-01-08 00:00 BRT = 2024-01-08 03:00 UTC
    expect(dayStartsAt).toBe(Date.UTC(2024, 0, 8, 3, 0, 0))
    expect(dayEndsAt).toBe(Date.UTC(2024, 0, 9, 3, 0, 0))
    expect(zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0)).toBe(Date.UTC(2024, 0, 8, 12, 0, 0))
  })

  it('respeita virada do dia no fuso (meia-noite local ≠ UTC)', () => {
    // 2024-01-08 23:00 BRT ainda é dia 8; 00:30 BRT do dia 9 é outro dia.
    const late = zonedCivilToUtc(TZ, 2024, 1, 8, 23, 0)
    const earlyNext = zonedCivilToUtc(TZ, 2024, 1, 9, 0, 30)
    expect(clinicDayOfWeek(TZ, late)).toBe(1)
    expect(clinicDayOfWeek(TZ, earlyNext)).toBe(2)
    expect(clinicDayBounds(TZ, '2024-01-08').dayEndsAt).toBe(
      clinicDayBounds(TZ, '2024-01-09').dayStartsAt,
    )
  })
})

describe('queryAvailability (#35 / REQ-030)', () => {
  it('gera grade de 15 min; buffer ocupa profissional e sala', () => {
    // Relógio antes do dia consultado para não filtrar slots «passados».
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, room, svc } = seedClinic(db, clock)
      const result = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: MONDAY },
        clock,
      )
      expect(result.createdReservation).toBe(false)
      expect(result.schedulingAllowed).toBe(true)
      expect(result.occupiedMinutes).toBe(75)
      // Expediente pro 09–12; ocupação 75 min → últimos inícios até 10:45
      const times = result.slots.map((s) => s.startsAt)
      expect(times[0]).toBe(zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0))
      expect(times.at(-1)).toBe(zonedCivilToUtc(TZ, 2024, 1, 8, 10, 45))
      expect(result.slots.every((s) => s.professionalId === pro.id)).toBe(true)
      expect(result.slots.every((s) => s.roomResourceId === room.id)).toBe(true)
      // Intervalo entre inícios = 15 min
      for (let i = 1; i < times.length; i++) {
        expect(times[i]! - times[i - 1]!).toBe(15 * 60_000)
      }
    } finally {
      close()
    }
  })

  it('horários adjacentes: fim de um (com buffer) bloqueia o seguinte no mesmo recurso', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, room, svc } = seedClinic(db, clock, {
        duration: 60,
        buffer: 15,
      })
      const start = zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0)
      // Compromisso 09:00–10:00 atendimento; ocupação até 10:15
      insertSyntheticAppointment(
        db,
        'clinic-demo-a',
        {
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: start,
          endsAt: start + 60 * 60_000,
          contactLabel: 'Cliente Fictícia',
        },
        clock,
      )
      const result = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: MONDAY, professionalId: pro.id },
        clock,
      )
      const starts = new Set(result.slots.map((s) => s.startsAt))
      expect(starts.has(start)).toBe(false)
      expect(starts.has(zonedCivilToUtc(TZ, 2024, 1, 8, 9, 15))).toBe(false)
      expect(starts.has(zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0))).toBe(false)
      // 10:15 é o primeiro livre (adjacente ao fim da ocupação)
      expect(starts.has(zonedCivilToUtc(TZ, 2024, 1, 8, 10, 15))).toBe(true)
    } finally {
      close()
    }
  })

  it('fim de expediente: slot que ultrapassa a janela semanal some', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, svc } = seedClinic(db, clock, {
        duration: 60,
        buffer: 15,
        proWindows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60 }],
      })
      const result = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: MONDAY },
        clock,
      )
      const starts = result.slots.map((s) => s.startsAt)
      // 09:00 e 09:15 cabem (ocupam até 10:15 / 10:30); 09:45 ocuparia até 11:00 ok;
      // 10:00 ocuparia até 11:15 > 11:00 → fora
      expect(starts).toContain(zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0))
      expect(starts).toContain(zonedCivilToUtc(TZ, 2024, 1, 8, 9, 45))
      expect(starts).not.toContain(zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0))
    } finally {
      close()
    }
  })

  it('bloqueio parcial remove só os intervalos em conflito', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, svc } = seedClinic(db, clock)
      createBlockOp(
        db,
        caller,
        {
          resourceId: pro.id,
          startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0),
          endsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 10, 30),
          reason: 'folga',
        },
        clock,
      )
      const result = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: MONDAY },
        clock,
      )
      const starts = new Set(result.slots.map((s) => s.startsAt))
      // 09:00 ocupa até 10:15 → overlap com bloqueio 10:00–10:30
      expect(starts.has(zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0))).toBe(false)
      // 09:15 ocupa até 10:30 → overlap
      expect(starts.has(zonedCivilToUtc(TZ, 2024, 1, 8, 9, 15))).toBe(false)
      // Antes do bloqueio com ocupação a terminar em 10:00
      // 08:45 fora do expediente; 10:30 livre se couber no expediente 12:00
      expect(starts.has(zonedCivilToUtc(TZ, 2024, 1, 8, 10, 30))).toBe(true)
    } finally {
      close()
    }
  })

  it('DEC-082: bloqueio numa sala da lista oferece a outra; a troca pontual usa essa sala', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, room, roomB, svc } = seedClinic(db, clock)
      upsertServiceOp(
        db,
        caller,
        {
          id: svc.id,
          name: 'Depilação a laser — pernas',
          durationMinutes: 60,
          bufferMinutes: 15,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'rooms', resourceIds: [room.id, roomB.id] },
        },
        clock,
      )
      createBlockOp(
        db,
        caller,
        {
          resourceId: room.id,
          startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0),
          endsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 12, 0),
          reason: 'manutencao',
        },
        clock,
      )
      const result = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: MONDAY, professionalId: pro.id },
        clock,
      )
      const nine = zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0)
      const nineSlot = result.slots.find((s) => s.startsAt === nine)
      expect(nineSlot?.roomResourceId).toBe(roomB.id)
      // Troca pontual: a equipa marca nesta vez na Sala 3.
      const check = checkSlotAvailabilityOp(
        db,
        caller,
        {
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: roomB.id,
          startsAt: nine,
        },
        clock,
      )
      expect(check.available).toBe(true)
      expect(check.slot?.roomResourceId).toBe(roomB.id)
    } finally {
      close()
    }
  })

  it('Horário proposto / compromisso cancelado não reservam; confirmado reserva', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, room, svc } = seedClinic(db, clock)
      const start = zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0)
      insertSyntheticAppointment(
        db,
        'clinic-demo-a',
        {
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: start,
          endsAt: start + 60 * 60_000,
          status: 'cancelled',
          contactLabel: 'Cancelada',
        },
        clock,
      )
      // Sem compromisso confirmado — 09:00 livre (pipeline horario_proposto
      // não cria appointments; Aguardando sinal idem — DEC-008/047).
      let result = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: MONDAY },
        clock,
      )
      expect(result.slots.some((s) => s.startsAt === start)).toBe(true)

      insertSyntheticAppointment(
        db,
        'clinic-demo-a',
        {
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: start,
          endsAt: start + 60 * 60_000,
          status: 'confirmed',
        },
        clock,
      )
      result = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: MONDAY },
        clock,
      )
      expect(result.slots.some((s) => s.startsAt === start)).toBe(false)
      expect(result.createdReservation).toBe(false)
    } finally {
      close()
    }
  })

  it('IDs de serviço/recurso de outra clínica são negados', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const a = bootClinicDb({ clock })
    const b = bootClinicDb({ clock })
    try {
      const seededA = seedClinic(a.db, clock, { tenantId: 'clinic-demo-a' })
      const seededB = seedClinic(b.db, clock, { tenantId: 'clinic-demo-b' })
      const callerA = workerCaller('clinic-demo-a', 'owner')

      expect(() =>
        queryAvailabilityOp(
          a.db,
          callerA,
          { serviceId: seededB.svc.id, date: MONDAY },
          clock,
        ),
      ).toThrow(NotFoundError)

      expect(() =>
        checkSlotAvailabilityOp(
          a.db,
          callerA,
          {
            serviceId: seededA.svc.id,
            professionalId: seededB.pro.id,
            roomResourceId: seededA.room.id,
            startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0),
          },
          clock,
        ),
      ).toThrow(NotFoundError)
    } finally {
      a.close()
      b.close()
    }
  })

  it('checkSlot devolve motivos e não cria reserva', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, room, svc } = seedClinic(db, clock)
      const start = zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0)
      const ok = checkSlotAvailabilityOp(
        db,
        caller,
        {
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: start,
        },
        clock,
      )
      expect(ok.available).toBe(true)
      expect(ok.reasons).toEqual([])
      expect(ok.createdReservation).toBe(false)
      expect(ok.slot?.occupiesUntil).toBe(start + 75 * 60_000)

      insertSyntheticAppointment(
        db,
        'clinic-demo-a',
        {
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: start,
          endsAt: start + 60 * 60_000,
        },
        clock,
      )
      const busy = checkSlotAvailabilityOp(
        db,
        caller,
        {
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: start,
        },
        clock,
      )
      expect(busy.available).toBe(false)
      expect(busy.reasons).toContain('appointment_conflict')
      expect(busy.createdReservation).toBe(false)
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`,
          'clinic-demo-a',
        )?.n,
      ).toBe(1)
    } finally {
      close()
    }
  })
})
