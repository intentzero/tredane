import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  reviewClinicServices,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from './index'

describe('reviewClinicServices (DEC-085)', () => {
  it('marca serviço sem profissional com motivo do servidor', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 27, 12, 0, 0))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Limpeza',
          durationMinutes: 60,
          bufferMinutes: 0,
          professionalIds: [],
          roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
        },
        clock,
      )
      const review = reviewClinicServices(db, caller.tenantId, clock)
      const row = review.services.find((s) => s.serviceId === svc.id)
      expect(row?.ready).toBe(false)
      expect(row?.blockReason).toMatch(/Nenhuma profissional/)
      expect(row?.fix.section).toBe('servico')
    } finally {
      close()
    }
  })

  it('serviço pronto devolve próximo horário', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 26, 12, 0, 0)) // segunda
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Limpeza',
          durationMinutes: 60,
          bufferMinutes: 0,
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
          windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
        },
        clock,
      )
      const review = reviewClinicServices(db, caller.tenantId, clock)
      const row = review.services.find((s) => s.serviceId === svc.id)
      expect(row?.ready).toBe(true)
      expect(row?.nextSlotStartsAt).toBeTypeOf('number')
      expect(row?.blockReason).toBeNull()
    } finally {
      close()
    }
  })
})
