import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ConflictError, ValidationError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import {
  cancelAppointmentOp,
  confirmAppointmentOp,
  queryAgendaViewOp,
  queryAvailabilityOp,
  rescheduleAppointmentOp,
  zonedCivilToUtc,
} from './index'

const TZ = 'America/Sao_Paulo'
const MONDAY = '2024-01-08'

function seedClinic(
  db: ReturnType<typeof bootClinicDb>['db'],
  clock: ReturnType<typeof createControllableClock>,
) {
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  const room = upsertResourceOp(
    db,
    caller,
    { kind: 'room', name: 'Sala 2', category: 'Sala com laser' },
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
      durationMinutes: 60,
      bufferMinutes: 15,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'category', category: 'Sala com laser' },
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: room.id,
      windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
    },
    clock,
  )
  return { caller, pro, room, svc, tenantId }
}

describe('agendamento atómico (#36)', () => {
  it('confirma num TX: compromisso + alocações + histórico + outbox', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, room, svc } = seedClinic(db, clock)
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0)
      const result = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-confirm-1',
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt,
          contactLabel: 'Ana Silva',
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      expect(result.idempotentReplay).toBe(false)
      expect(result.value.status).toBe('confirmed')
      expect(result.value.version).toBe(1)
      expect(result.outbox.some((o) => o.type === 'appointment.confirmed')).toBe(
        true,
      )

      const allocs = db.all<{ resource_kind: string }>(
        `SELECT resource_kind FROM appointment_allocations WHERE appointment_id = ?`,
        result.value.id,
      )
      expect(allocs.map((a) => a.resource_kind).sort()).toEqual([
        'professional',
        'room',
      ])

      const events = db.all<{ operation: string }>(
        `SELECT operation FROM appointment_events WHERE appointment_id = ?`,
        result.value.id,
      )
      expect(events).toEqual([{ operation: 'confirmed' }])
    } finally {
      close()
    }
  })

  it('duas confirmações concorrentes: no máximo uma reserva (REQ-031)', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, room, svc } = seedClinic(db, clock)
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0)
      const first = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-a',
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      expect(first.value.id).toBeTruthy()

      expect(() =>
        confirmAppointmentOp(
          db,
          caller,
          {
            clientRequestId: 'req-b',
            serviceId: svc.id,
            professionalId: pro.id,
            roomResourceId: room.id,
            startsAt,
            actorClerkUserId: 'user_synth_attendant_a',
          },
          clock,
        ),
      ).toThrow(ConflictError)

      const count = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND status = 'confirmed'`,
        'clinic-demo-a',
      )
      expect(count?.n).toBe(1)

      // Slot some da disponibilidade.
      const avail = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: MONDAY, professionalId: pro.id },
        clock,
      )
      expect(avail.slots.some((s) => s.startsAt === startsAt)).toBe(false)
    } finally {
      close()
    }
  })

  it('retry com o mesmo clientRequestId é idempotente', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, room, svc } = seedClinic(db, clock)
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 11, 0)
      const input = {
        clientRequestId: 'req-idem-1',
        serviceId: svc.id,
        professionalId: pro.id,
        roomResourceId: room.id,
        startsAt,
        actorClerkUserId: 'user_synth_owner_a',
      }
      const a = confirmAppointmentOp(db, caller, input, clock)
      const b = confirmAppointmentOp(db, caller, input, clock)
      expect(b.idempotentReplay).toBe(true)
      expect(b.value.id).toBe(a.value.id)
      const count = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`,
        'clinic-demo-a',
      )
      expect(count?.n).toBe(1)
    } finally {
      close()
    }
  })

  it('cancelar sem motivo falha; com motivo liberta recursos (AC-36)', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, room, svc } = seedClinic(db, clock)
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0)
      const created = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-c1',
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )

      expect(() =>
        cancelAppointmentOp(
          db,
          caller,
          {
            clientRequestId: 'req-c2',
            appointmentId: created.value.id,
            reason: '' as 'outro',
            actorClerkUserId: 'user_synth_owner_a',
          },
          clock,
        ),
      ).toThrow(ValidationError)

      const cancelled = cancelAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-c3',
          appointmentId: created.value.id,
          reason: 'contato_desistiu',
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      expect(cancelled.value.status).toBe('cancelled')
      expect(cancelled.value.changeReason).toBe('contato_desistiu')

      const allocs = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointment_allocations WHERE appointment_id = ?`,
        created.value.id,
      )
      expect(allocs?.n).toBe(0)

      // Horário volta a ficar livre.
      const avail = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: MONDAY, professionalId: pro.id },
        clock,
      )
      expect(avail.slots.some((s) => s.startsAt === startsAt)).toBe(true)
    } finally {
      close()
    }
  })

  it('reagendar com conflito preserva o compromisso anterior (AC-10)', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, room, svc } = seedClinic(db, clock)
      const firstStart = zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0)
      const blockerStart = zonedCivilToUtc(TZ, 2024, 1, 8, 11, 0)
      const apt = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-r1',
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: firstStart,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-r2',
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: blockerStart,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )

      expect(() =>
        rescheduleAppointmentOp(
          db,
          caller,
          {
            clientRequestId: 'req-r3',
            appointmentId: apt.value.id,
            reason: 'contato_remarcou',
            professionalId: pro.id,
            roomResourceId: room.id,
            startsAt: blockerStart,
            actorClerkUserId: 'user_synth_owner_a',
          },
          clock,
        ),
      ).toThrow(ConflictError)

      const still = db.get<{ starts_at: number; status: string; version: number }>(
        `SELECT starts_at, status, version FROM appointments WHERE id = ?`,
        apt.value.id,
      )
      expect(still?.starts_at).toBe(firstStart)
      expect(still?.status).toBe('confirmed')
      expect(still?.version).toBe(1)

      const okStart = zonedCivilToUtc(TZ, 2024, 1, 8, 14, 0)
      const moved = rescheduleAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-r4',
          appointmentId: apt.value.id,
          reason: 'contato_remarcou',
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: okStart,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      expect(moved.value.startsAt).toBe(okStart)
      expect(moved.value.version).toBe(2)
      expect(moved.value.changeReason).toBe('contato_remarcou')
    } finally {
      close()
    }
  })

  it('visão dia/semana lista compromissos confirmados (REQ-034)', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, room, svc } = seedClinic(db, clock)
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0)
      confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-v1',
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt,
          contactLabel: 'Beatriz',
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      const day = queryAgendaViewOp(
        db,
        caller,
        { date: MONDAY, view: 'day' },
        clock,
      )
      expect(day.appointments).toHaveLength(1)
      expect(day.appointments[0]?.contactLabel).toBe('Beatriz')

      const week = queryAgendaViewOp(
        db,
        caller,
        { date: MONDAY, view: 'week' },
        clock,
      )
      expect(week.appointments).toHaveLength(1)
      expect(week.rangeEndsAt - week.rangeStartsAt).toBeGreaterThan(
        6 * 24 * 60 * 60 * 1000,
      )
    } finally {
      close()
    }
  })

  it('rollback: falha após validação não deixa alocações órfãs', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, room, svc } = seedClinic(db, clock)
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0)
      // Força falha de motivo inválido no cancel — não deve alterar estado.
      const created = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-rb1',
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      expect(() =>
        cancelAppointmentOp(
          db,
          caller,
          {
            clientRequestId: 'req-rb2',
            appointmentId: created.value.id,
            reason: 'motivo_inventado' as 'outro',
            actorClerkUserId: 'user_synth_owner_a',
          },
          clock,
        ),
      ).toThrow(ValidationError)

      const row = db.get<{ status: string; n: number }>(
        `SELECT a.status, (SELECT COUNT(*) FROM appointment_allocations al WHERE al.appointment_id = a.id) AS n
         FROM appointments a WHERE a.id = ?`,
        created.value.id,
      )
      expect(row?.status).toBe('confirmed')
      expect(row?.n).toBe(2)
    } finally {
      close()
    }
  })
})
