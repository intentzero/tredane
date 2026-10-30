/**
 * DEC-075 / S4 — modo «Uma profissional para todas».
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ConflictError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  insertSyntheticAppointment,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import {
  checkSlotAvailabilityOp,
  confirmAppointmentOp,
  queryAvailabilityOp,
  zonedCivilToUtc,
} from './index'

const TZ = 'America/Sao_Paulo'
const MONDAY = '2024-01-08'
const at = (h: number, m = 0) => zonedCivilToUtc(TZ, 2024, 1, 8, h, m)
const DAY = { dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }

function seedSandra(mode: 'cada_profissional' | 'uma_para_todas' = 'uma_para_todas') {
  const clock = createControllableClock(Date.UTC(2024, 0, 1))
  const boot = bootClinicDb({ clock })
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const sala = upsertResourceOp(
    boot.db,
    caller,
    {
      kind: 'room',
      name: 'Sala da Sandra',
      capacity: 4,
      attendanceMode: mode,
    },
    clock,
  )
  const outra = upsertResourceOp(
    boot.db,
    caller,
    { kind: 'room', name: 'Outra sala', capacity: 1 },
    clock,
  )
  const sandra = upsertResourceOp(
    boot.db,
    caller,
    { kind: 'professional', name: 'Sandra', homeRoomId: sala.id },
    clock,
  )
  setWeeklyWindowsOp(boot.db, caller, { resourceId: sandra.id, windows: [DAY] }, clock)
  const svc = upsertServiceOp(
    boot.db,
    caller,
    {
      name: 'Grupo',
      durationMinutes: 60,
      bufferMinutes: 0,
      professionalIds: [sandra.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  let n = 0
  const book = (startsAt: number, roomId?: string) =>
    confirmAppointmentOp(
      boot.db,
      caller,
      {
        clientRequestId: `g-${(n += 1)}`,
        serviceId: svc.id,
        professionalId: sandra.id,
        roomResourceId: roomId,
        startsAt,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
    )
  return { ...boot, clock, caller, sala, outra, sandra, svc, book }
}

describe('S4 — Uma profissional para todas', () => {
  it('Sandra com capacidade 4 aceita quatro clientes; a quinta é recusada', () => {
    const s = seedSandra()
    try {
      expect(s.sala.attendanceMode).toBe('uma_para_todas')
      s.book(at(9))
      s.book(at(9))
      s.book(at(9))
      s.book(at(9))
      expect(() => s.book(at(9))).toThrow(ConflictError)
      const avail = queryAvailabilityOp(
        s.db,
        s.caller,
        { serviceId: s.svc.id, date: MONDAY, professionalId: s.sandra.id },
        s.clock,
      )
      expect(avail.slots.some((x) => x.startsAt === at(9))).toBe(false)
      expect(avail.slots.some((x) => x.startsAt === at(10))).toBe(true)
    } finally {
      s.close()
    }
  })

  it('com vaga livre não recusa por falta de outra profissional', () => {
    const s = seedSandra()
    try {
      s.book(at(9))
      s.book(at(9))
      // Ainda há 2 vagas; a mesma Sandra marca de novo.
      expect(s.book(at(9)).value.status).toBe('confirmed')
    } finally {
      s.close()
    }
  })

  it('Sandra com cliente na sala às 9h não marca noutra sala às 9h', () => {
    const s = seedSandra()
    try {
      s.book(at(9))
      const other = checkSlotAvailabilityOp(
        s.db,
        s.caller,
        {
          serviceId: s.svc.id,
          professionalId: s.sandra.id,
          roomResourceId: s.outra.id,
          startsAt: at(9),
        },
        s.clock,
      )
      expect(other.available).toBe(false)
      expect(other.reasons).toContain('appointment_conflict')
    } finally {
      s.close()
    }
  })

  it('a mesma cliente com dois serviços conta uma pessoa (cabem mais três)', () => {
    const s = seedSandra()
    try {
      const contactId = 'cliente-sandra'
      insertSyntheticAppointment(
        s.db,
        'clinic-demo-a',
        {
          serviceId: s.svc.id,
          professionalId: s.sandra.id,
          roomResourceId: s.sala.id,
          startsAt: at(9),
          endsAt: at(9, 30),
          contactId,
        },
        s.clock,
      )
      insertSyntheticAppointment(
        s.db,
        'clinic-demo-a',
        {
          serviceId: s.svc.id,
          professionalId: s.sandra.id,
          roomResourceId: s.sala.id,
          startsAt: at(9, 15),
          endsAt: at(9, 45),
          contactId,
        },
        s.clock,
      )
      // 1 pessoa na sala → ainda cabem 3.
      s.book(at(9))
      s.book(at(9))
      s.book(at(9))
      expect(() => s.book(at(9))).toThrow(ConflictError)
    } finally {
      s.close()
    }
  })

  it('voltar a cada_profissional faz a Sandra travar só a si; marcações ficam', () => {
    const s = seedSandra('uma_para_todas')
    try {
      s.book(at(9))
      s.book(at(9))
      const nBefore = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE status = 'confirmed'`,
      )!.n
      expect(nBefore).toBe(2)
      const updated = upsertResourceOp(
        s.db,
        s.caller,
        {
          id: s.sala.id,
          kind: 'room',
          name: s.sala.name,
          capacity: 4,
          attendanceMode: 'cada_profissional',
        },
        s.clock,
      )
      expect(updated.attendanceMode).toBe('cada_profissional')
      // Já tem 1 cliente às 9 → segunda da mesma profissional é recusada.
      expect(() => s.book(at(9))).toThrow(ConflictError)
      const nAfter = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE status = 'confirmed'`,
      )!.n
      expect(nAfter).toBe(2)
    } finally {
      s.close()
    }
  })

  it('capacidade 1 força cada_profissional e não aceita modo grupo', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const boot = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const room = upsertResourceOp(
        boot.db,
        caller,
        {
          kind: 'room',
          name: 'Única',
          capacity: 1,
          attendanceMode: 'uma_para_todas',
        },
        clock,
      )
      expect(room.attendanceMode).toBe('cada_profissional')
      expect(room.capacity).toBe(1)
    } finally {
      boot.close()
    }
  })
})
