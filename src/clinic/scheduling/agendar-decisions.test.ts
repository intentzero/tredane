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

function setup() {
  const clock = createControllableClock(Date.UTC(2024, 0, 5, 12))
  const booted = bootClinicDb({ clock })
  const { db } = booted
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, ACTOR)
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Geral' }, clock)
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
      name: 'Limpeza de pele',
      durationMinutes: 60,
      bufferMinutes: 15,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }] },
    clock,
  )
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

describe('Agendar — DEC-076 retira duração ajustável; DEC-052 mantém-se', () => {
  it('DEC-076: duração diferente da do cadastro é recusada; a do cadastro ocupa duração + intervalo', () => {
    const { db, close, caller, clock, book, svc, pro } = setup()
    try {
      expect(() => book(9, { appliedDurationMinutes: 90 })).toThrow(ValidationError)
      const r = book(9, { appliedDurationMinutes: 60 })
      expect(r.value.endsAt).toBe(at(10))
      expect(r.value.occupiesUntil).toBe(at(10, 15))
      expect(r.value.defaultDurationMinutes).toBe(60)
      expect(r.value.appliedDurationMinutes).toBe(60)
      const starts = queryAvailabilityOp(db, caller, { serviceId: svc.id, date: '2024-01-08', professionalId: pro.id }, clock).slots.map((s) => s.startsAt)
      expect(starts).not.toContain(at(10))
      expect(starts).toContain(at(10, 15))
    } finally {
      close()
    }
  })

  it('DEC-076: reagendar mantém a duração já gravada, mesmo que tenha sido ajustada antes', () => {
    const { db, close, caller, clock, book, pro, tenantId } = setup()
    try {
      const r = book(9)
      db.run(
        `UPDATE appointments SET applied_duration_minutes = 30 WHERE tenant_id = ? AND id = ?`,
        tenantId,
        r.value.id,
      )
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

  it('DEC-076: override de duração sem bloco é recusado', () => {
    const { close, book } = setup()
    try {
      expect(() => book(9, { durationMinutesOverride: 90 })).toThrow(ValidationError)
      expect(() =>
        book(10, { appliedDurationMinutes: 60, durationMinutesOverride: 90 }),
      ).toThrow(ValidationError)
    } finally {
      close()
    }
  })

  it('DEC-076: reagendar sem coluna de duração mantém o intervalo já gravado', () => {
    const { db, close, caller, clock, book, pro, tenantId } = setup()
    try {
      const r = book(9)
      const span = r.value.startsAt + 30 * 60_000
      db.run(
        `UPDATE appointments SET applied_duration_minutes = NULL, ends_at = ? WHERE tenant_id = ? AND id = ?`,
        span,
        tenantId,
        r.value.id,
      )
      const moved = rescheduleAppointmentOp(
        db,
        caller,
        { clientRequestId: 'rs-null', appointmentId: r.value.id, reason: 'contato_remarcou', professionalId: pro.id, startsAt: at(14), actorClerkUserId: ACTOR },
        clock,
      )
      expect(moved.value.endsAt - moved.value.startsAt).toBe(30 * 60_000)
      expect(moved.value.appliedDurationMinutes).toBe(30)
    } finally {
      close()
    }
  })

  it('DEC-076: gravar o procedimento ignora o pedido de duração ajustável', () => {
    const { db, close, caller, clock, pro } = setup()
    try {
      const saved = upsertServiceOp(
        db,
        caller,
        {
          name: 'X',
          durationMinutes: 60,
          bufferMinutes: 0,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
          durationAdjustable: true,
          durationMinMinutes: 30,
          durationMaxMinutes: 90,
        },
        clock,
      )
      expect(saved.durationAdjustable).toBe(false)
      expect(saved.durationMinMinutes).toBeNull()
      expect(saved.durationMaxMinutes).toBeNull()
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
