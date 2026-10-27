import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ValidationError, ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { ensureOpenOpportunity } from '../pipeline/operations'
import { getOpportunityOp } from '../pipeline'
import { confirmAppointmentOp, queryAvailabilityOp, rescheduleAppointmentOp, zonedCivilToUtc } from './index'

const TZ = 'America/Sao_Paulo'
const ACTOR = 'user_synth_owner_a'
const at = (h: number, m = 0) => zonedCivilToUtc(TZ, 2024, 1, 8, h, m)

function setup(adjustable = true) {
  const clock = createControllableClock(Date.UTC(2024, 0, 5, 12))
  const booted = bootClinicDb({ clock })
  const { db } = booted
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, ACTOR)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Dra. Ana' }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Limpeza de pele',
      durationMinutes: 60,
      bufferMinutes: 15,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
      durationAdjustable: adjustable,
      durationMinMinutes: adjustable ? 30 : null,
      durationMaxMinutes: adjustable ? 90 : null,
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }] },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Geral' }, clock)
  setWeeklyWindowsOp(
    db,
    caller,
    { resourceId: room.id, windows: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }] },
    clock,
  )
  const book = (h: number, extra: Record<string, unknown> = {}) =>
    confirmAppointmentOp(
      db,
      caller,
      { clientRequestId: `apt-${h}-${Math.random()}`, serviceId: svc.id, professionalId: pro.id, startsAt: at(h), actorClerkUserId: ACTOR, ...extra },
      clock,
    )
  return { ...booted, clock, caller, tenantId, pro, svc, book }
}

describe('Agendar — DEC-051/052 (Confirmados, card t1868s7504)', () => {
  it('DEC-051: duração aplicada grava padrão + aplicada e ocupa aplicada + buffer', () => {
    const { db, close, caller, clock, book, svc, pro } = setup()
    try {
      const r = book(9, { appliedDurationMinutes: 90 })
      expect(r.value.endsAt).toBe(at(10, 30))
      expect(r.value.occupiesUntil).toBe(at(10, 45))
      expect(r.value.defaultDurationMinutes).toBe(60)
      expect(r.value.appliedDurationMinutes).toBe(90)
      const starts = queryAvailabilityOp(db, caller, { serviceId: svc.id, date: '2024-01-08', professionalId: pro.id }, clock).slots.map((s) => s.startsAt)
      expect(starts).not.toContain(at(10, 30))
      expect(starts).toContain(at(10, 45))
    } finally {
      close()
    }
  })

  it('DEC-051: fora dos limites, fora de 15 min ou serviço não ajustável → erro', () => {
    const a = setup()
    try {
      expect(() => a.book(9, { appliedDurationMinutes: 100 })).toThrow(ValidationError)
      expect(() => a.book(9, { appliedDurationMinutes: 120 })).toThrow(ValidationError)
      expect(() => a.book(9, { appliedDurationMinutes: 15 })).toThrow(ValidationError)
    } finally {
      a.close()
    }
    const b = setup(false)
    try {
      expect(() => b.book(9, { appliedDurationMinutes: 90 })).toThrow(ValidationError)
      expect(b.book(9, { appliedDurationMinutes: 60 }).value.appliedDurationMinutes).toBe(60)
    } finally {
      b.close()
    }
  })

  it('DEC-051(f): reagendar mantém a duração aplicada', () => {
    const { db, close, caller, clock, book, pro } = setup()
    try {
      const r = book(9, { appliedDurationMinutes: 30 })
      const moved = rescheduleAppointmentOp(
        db,
        caller,
        { clientRequestId: 'rs-1', appointmentId: r.value.id, reason: 'contato_remarcou', professionalId: pro.id, startsAt: at(14), actorClerkUserId: ACTOR },
        clock,
      )
      expect(moved.value.endsAt - moved.value.startsAt).toBe(30 * 60_000)
      expect(moved.value.appliedDurationMinutes).toBe(30)
    } finally {
      close()
    }
  })

  it('DEC-051(b): owner só grava limites válidos', () => {
    const { db, close, caller, clock, pro } = setup()
    try {
      expect(() =>
        upsertServiceOp(
          db,
          caller,
          { name: 'X', durationMinutes: 60, bufferMinutes: 0, professionalIds: [pro.id], durationAdjustable: true, durationMinMinutes: 70, durationMaxMinutes: 90 },
          clock,
        ),
      ).toThrow(ValidationError)
    } finally {
      close()
    }
  })

  it('DEC-052: confirmar com oportunidade move para «Agendado» com histórico', () => {
    const { db, close, caller, clock, book, tenantId } = setup()
    try {
      const conv = ingestContactMessage(
        db,
        workerCaller(tenantId),
        { providerEventKey: 'wa:dec052', waId: '5511999990052', displayName: 'Marina', body: 'Oi' },
        clock,
      ).conversation!
      const opp = ensureOpenOpportunity(db, { tenantId, contactId: conv.contactId, conversationId: conv.id }, clock).opportunity
      book(9, { opportunityId: opp.id, conversationId: conv.id })
      const after = getOpportunityOp(db, caller, opp.id, clock)
      expect(after.stage).toBe('agendado')
      expect(after.history.map((h) => h.toStage)).toContain('agendado')
    } finally {
      close()
    }
  })
})
