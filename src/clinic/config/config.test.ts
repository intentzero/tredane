import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { CLINIC_SCHEMA_VERSION, ValidationError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  assertResourcesUsableForBooking,
  createBlockOp,
  getConfigSnapshotOp,
  getReadinessOp,
  insertSyntheticAppointment,
  setResourceActiveOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from './index'

describe('Clinic config (#28)', () => {
  it('migra para schema v3 com tabelas de configuração', () => {
    const { db, close } = bootClinicDb()
    try {
      const state = db.get<{ version: number }>('SELECT version FROM clinic_schema_state WHERE id = 1')
      expect(state?.version).toBe(CLINIC_SCHEMA_VERSION)
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='services'`,
        )?.n,
      ).toBe(1)
    } finally {
      close()
    }
  })

  it('owner configura serviço/recursos/expediente; readiness libera agenda sem WhatsApp', () => {
    const clock = createControllableClock(1_700_000_000_000)
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      expect(getReadinessOp(db, caller, clock).schedulingAllowed).toBe(false)

      const pro = upsertResourceOp(
        db,
        caller,
        { kind: 'professional', name: 'Dra. Paula Reis' },
        clock,
      )
      const room = upsertResourceOp(
        db,
        caller,
        { kind: 'room', name: 'Sala 2', category: 'Sala com laser' },
        clock,
      )
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Depilação a laser — pernas',
          durationMinutes: 60,
          bufferMinutes: 15,
          priceCents: 18000,
          clientExplanation: 'Limpeza profunda fictícia para testes.',
          professionalIds: [pro.id],
          roomRequirement: { mode: 'category', category: 'Sala com laser' },
        },
        clock,
      )
      expect(svc.durationMinutes + svc.bufferMinutes).toBe(75)

      setWeeklyWindowsOp(
        db,
        caller,
        {
          resourceId: pro.id,
          windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 }],
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

      const readiness = getReadinessOp(db, caller, clock)
      expect(readiness.agendaConfigured).toBe(true)
      expect(readiness.schedulingAllowed).toBe(true)
      expect(readiness.readyToServe).toBe(false)
      expect(readiness.missing).toContain('whatsapp')
      expect(readiness.timezone).toBe('America/Sao_Paulo')
    } finally {
      close()
    }
  })

  it('rejeita duração fora da grade de 15 min', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a', 'owner')
      expect(() =>
        upsertServiceOp(
          db,
          caller,
          {
            name: 'Inválido',
            durationMinutes: 20,
            bufferMinutes: 0,
            professionalIds: [],
          },
          clock,
        ),
      ).toThrow(ValidationError)
    } finally {
      close()
    }
  })

  it('bloqueio lista compromissos afectados sem cancelá-los', () => {
    const clock = createControllableClock(1_700_000_000_000)
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'owner')
      const pro = upsertResourceOp(
        db,
        caller,
        { kind: 'professional', name: 'Dra. Paula' },
        clock,
      )
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Limpeza',
          durationMinutes: 60,
          bufferMinutes: 0,
          professionalIds: [pro.id],
        },
        clock,
      )
      const starts = clock.nowMs() + 86_400_000
      const apt = insertSyntheticAppointment(
        db,
        'clinic-demo-a',
        {
          serviceId: svc.id,
          professionalId: pro.id,
          startsAt: starts,
          endsAt: starts + 3_600_000,
          contactLabel: 'Cliente Fictícia',
        },
        clock,
      )

      const result = createBlockOp(
        db,
        caller,
        {
          resourceId: pro.id,
          startsAt: starts - 60_000,
          endsAt: starts + 7_200_000,
          reason: 'folga',
        },
        clock,
      )
      expect(result.created).toBe(true)
      expect(result.affectedAppointments.map((a) => a.id)).toEqual([apt.id])

      const still = db.get<{ status: string }>(
        `SELECT status FROM appointments WHERE id = ?`,
        apt.id,
      )
      expect(still?.status).toBe('confirmed')
    } finally {
      close()
    }
  })

  it('inactivar recurso mantém histórico e bloqueia uso em novos agendamentos', () => {
    const clock = createControllableClock(1_700_000_000_000)
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'owner')
      const pro = upsertResourceOp(
        db,
        caller,
        { kind: 'professional', name: 'Dra. Paula' },
        clock,
      )
      const room = upsertResourceOp(
        db,
        caller,
        { kind: 'room', name: 'Sala 1', category: 'Sala comum' },
        clock,
      )
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Limpeza',
          durationMinutes: 45,
          bufferMinutes: 15,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'resource', resourceId: room.id },
        },
        clock,
      )

      setResourceActiveOp(db, caller, room.id, false, clock)
      const snap = getConfigSnapshotOp(db, caller, clock)
      expect(snap.resources.find((r) => r.id === room.id)?.active).toBe(false)

      expect(() =>
        assertResourcesUsableForBooking(db, 'clinic-demo-a', {
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
        }),
      ).toThrow(ValidationError)
    } finally {
      close()
    }
  })

  it('duas clínicas isoladas no SQLite em memória', () => {
    const a = bootClinicDb()
    const b = bootClinicDb()
    try {
      const callerA = workerCaller('clinic-demo-a', 'owner')
      const callerB = workerCaller('clinic-demo-b', 'owner')
      upsertResourceOp(
        a.db,
        callerA,
        { kind: 'professional', name: 'Só em A' },
        a.clock,
      )
      const snapB = getConfigSnapshotOp(b.db, callerB, b.clock)
      expect(snapB.resources).toEqual([])
      const snapA = getConfigSnapshotOp(a.db, callerA, a.clock)
      expect(snapA.resources).toHaveLength(1)
    } finally {
      a.close()
      b.close()
    }
  })
})
