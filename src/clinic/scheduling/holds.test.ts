import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ConflictError, ValidationError, ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { STATEMENTS as M16 } from '../migrations/0016_schedule_holds'
import { STATEMENTS as M18 } from '../migrations/0018_holds_require_time'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { getOpportunityOp } from '../pipeline'
import {
  confirmAppointmentOp,
  createHoldOp,
  listHoldsOp,
  previewHoldOp,
  queryAvailabilityOp,
  zonedCivilToUtc,
} from './index'

const TZ = 'America/Sao_Paulo'
const ACTOR = 'user_synth_owner_a'
const at = (h: number, m = 0) => zonedCivilToUtc(TZ, 2024, 1, 8, h, m)

function setup() {
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
      name: 'Preenchimento labial',
      durationMinutes: 60,
      bufferMinutes: 0,
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
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Geral' }, clock)
  setWeeklyWindowsOp(
    db,
    caller,
    { resourceId: room.id, windows: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }] },
    clock,
  )
  const ingest = (n: number) =>
    ingestContactMessage(
      db,
      workerCaller(tenantId),
      {
        providerEventKey: `wa:hold:${n}`,
        waId: `551199999000${n}`,
        displayName: `Marina ${n}`,
        body: 'Oi',
      },
      clock,
    ).conversation!
  const conv = ingest(1)
  const hold = (over: Partial<Parameters<typeof createHoldOp>[2]> = {}) =>
    createHoldOp(
      db,
      caller,
      {
        clientRequestId: `hold-${Math.random()}`,
        conversationId: conv.id,
        serviceId: svc.id,
        professionalId: pro.id,
        durationMinutes: 60,
        windowStartsAt: at(8),
        windowEndsAt: at(12),
        startsAt: at(9),
        actorClerkUserId: ACTOR,
        actorDisplayName: 'Atendente',
        ...over,
      },
      clock,
    )
  const book = (h: number, id = `apt-${h}`) =>
    confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId: id,
        serviceId: svc.id,
        professionalId: pro.id,
        startsAt: at(h),
        actorClerkUserId: ACTOR,
      },
      clock,
    )
  return { ...booted, clock, caller, tenantId, pro, svc, conv, ingest, hold, book }
}

describe('reserva por bloco (sempre com hora)', () => {
  it('migração 18: sem «A definir» no CHECK, FKs íntegras, sem tabelas temporárias', () => {
    const { db, close, conv } = setup()
    try {
      expect(db.all(`PRAGMA foreign_key_check`)).toEqual([])
      expect(
        db.all(`SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%__m18' OR name LIKE '%__stash18')`),
      ).toEqual([])
      expect(() =>
        db.run(`UPDATE opportunities SET stage = 'a_definir' WHERE conversation_id = ?`, conv.id),
      ).toThrow()
      const idx = db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='opportunities' AND name LIKE 'idx_%'`,
      )
      expect(idx.map((i) => i.name).sort()).toEqual([
        'idx_opportunities_contact',
        'idx_opportunities_open_conversation',
        'idx_opportunities_stage',
      ])
    } finally {
      close()
    }
  })

  it('migração 18 limpa dados da 16: «A definir» volta, blocos sem hora cancelados', () => {
    const { db, close, caller, clock, conv, ingest, svc, pro, hold } = setup()
    try {
      const done = hold({ clientRequestId: 'kept' })
      const conv2 = ingest(2)
      // Volta ao schema 16 (CHECK com a_definir) para simular dados antigos.
      db.transactionSync(() => {
        for (const sql of M16.filter((x) => !x.includes(' schedule_holds') && !x.includes('idx_schedule_holds'))) db.run(sql)
      })
      const oppOf = (conversationId: string) =>
        db.get<{ id: string }>(`SELECT id FROM opportunities WHERE conversation_id = ? AND status = 'open'`, conversationId)
      void conv
      const old = oppOf(conv2.id)!.id
      db.run(`UPDATE opportunities SET stage = 'a_definir' WHERE id = ?`, old)
      db.run(
        `INSERT INTO opportunity_stage_history (id, tenant_id, opportunity_id, from_stage, to_stage, created_at)
         VALUES ('h-old', ?, ?, 'em_atendimento', 'a_definir', 1)`,
        caller.tenantId,
        old,
      )
      for (const [id, status] of [['hold-a', 'active'], ['hold-e', 'expired']] as const) {
        db.run(
          `INSERT INTO schedule_holds (id, tenant_id, opportunity_id, conversation_id, contact_id, service_id,
             professional_id, duration_minutes, window_starts_at, window_ends_at, status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 60, ?, ?, ?, 'x', 1, 1)`,
          id,
          caller.tenantId,
          old,
          conv2.id,
          conv2.contactId,
          svc.id,
          pro.id,
          at(13),
          at(18),
          status,
        )
      }
      db.transactionSync(() => {
        for (const sql of M18) db.run(sql)
      })
      expect(db.all(`PRAGMA foreign_key_check`)).toEqual([])
      expect(getOpportunityOp(db, caller, old, clock).stage).toBe('em_atendimento')
      const hist = db.get<{ to_stage: string; note: string }>(
        `SELECT to_stage, note FROM opportunity_stage_history WHERE id = 'h-old'`,
      )
      expect(hist).toMatchObject({ to_stage: 'em_atendimento' })
      expect(hist?.note).toContain('A definir')
      expect(
        listHoldsOp(db, caller, { statuses: ['cancelled'] }, clock).map((h) => h.id).sort(),
      ).toEqual(['hold-a', 'hold-e'])
      // Reserva já resolvida (com compromisso) fica intacta.
      expect(listHoldsOp(db, caller, { statuses: ['resolved'] }, clock).map((h) => h.id)).toEqual([done.value.hold.id])
      expect(getOpportunityOp(db, caller, oppOf(done.value.hold.conversationId)!.id, clock).stage).toBe('agendado')
    } finally {
      close()
    }
  })

  it('reservar exige hora e cria compromisso com a DURAÇÃO DO BLOCO; contato vai para «Agendado»', () => {
    const { db, close, caller, clock, hold } = setup()
    try {
      const r = hold({ durationMinutes: 90, startsAt: at(9, 30) })
      expect(r.value.hold.status).toBe('resolved')
      expect(r.value.hold.appointmentId).toBe(r.value.appointment.id)
      expect(r.value.appointment.status).toBe('confirmed')
      expect(r.value.appointment.startsAt).toBe(at(9, 30))
      // Serviço tem 60 min; o bloco tem 90 — o compromisso ocupa 90.
      expect(r.value.appointment.endsAt).toBe(at(11))
      expect(r.outbox.map((o) => o.type)).toContain('schedule_hold.created')
      const opp = getOpportunityOp(db, caller, r.value.hold.opportunityId!, clock)
      expect(opp.stage).toBe('agendado')
      expect(opp.linkedAppointment?.id).toBe(r.value.appointment.id)
      expect(opp.history.map((x) => x.toStage)).toContain('agendado')
      expect(listHoldsOp(db, caller, {}, clock)).toEqual([])
    } finally {
      close()
    }
  })

  it('horários livres consideram a duração do bloco', () => {
    const { db, close, caller, clock, book, svc, pro } = setup()
    try {
      book(10)
      const avail = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: '2024-01-08', professionalId: pro.id, durationMinutesOverride: 90 },
        clock,
      )
      const starts = avail.slots.map((s) => s.startsAt)
      expect(starts).toContain(at(8, 30))
      expect(starts).not.toContain(at(9)) // 9:00 + 90 min bate nas 10:00
      expect(avail.slots.find((s) => s.startsAt === at(8))?.endsAt).toBe(at(9, 30))
    } finally {
      close()
    }
  })

  it('conflito na hora: nada é reservado (rollback)', () => {
    const { db, close, caller, clock, hold, book } = setup()
    try {
      book(10)
      expect(() => hold({ startsAt: at(9), durationMinutes: 90 })).toThrow(ConflictError)
      expect(listHoldsOp(db, caller, { statuses: ['active', 'resolved', 'expired', 'cancelled'] }, clock)).toEqual([])
    } finally {
      close()
    }
  })

  it('regressão: bloco mais longo que o serviço ocupa occupies_until, não a duração do serviço', () => {
    const { db, close, caller, clock, hold, svc, pro } = setup()
    try {
      // Serviço 60 min; bloco 90 min às 9:00 → ocupa até 10:30.
      const r = hold({ durationMinutes: 90, startsAt: at(9) })
      expect(r.value.appointment.occupiesUntil).toBe(at(10, 30))
      const avail = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: '2024-01-08', professionalId: pro.id },
        clock,
      )
      const starts = avail.slots.map((s) => s.startsAt)
      expect(starts).not.toContain(at(10)) // antes do fix: 10:00 aparecia livre
      expect(starts).not.toContain(at(9, 45))
      expect(starts).toContain(at(10, 30))
      expect(() =>
        confirmAppointmentOp(
          db,
          caller,
          { clientRequestId: 'apt-overlap', serviceId: svc.id, professionalId: pro.id, startsAt: at(10), actorClerkUserId: ACTOR },
          clock,
        ),
      ).toThrow(ConflictError)
      // Outro bloco que cairia dentro dos 90 min também é recusado.
      expect(() => hold({ startsAt: at(10), durationMinutes: 30, windowStartsAt: at(10), windowEndsAt: at(12) })).toThrow(ConflictError)
    } finally {
      close()
    }
  })

  it('idempotente por clientRequestId', () => {
    const { close, hold } = setup()
    try {
      const a = hold({ clientRequestId: 'same' })
      const b = hold({ clientRequestId: 'same' })
      expect(b.idempotentReplay).toBe(true)
      expect(b.value.hold.id).toBe(a.value.hold.id)
      expect(b.value.appointment.id).toBe(a.value.appointment.id)
    } finally {
      close()
    }
  })

  it('valida hora dentro do período, período e duração', () => {
    const { db, close, caller, clock, hold, pro } = setup()
    try {
      expect(() => hold({ startsAt: at(7) })).toThrow(ValidationError)
      expect(() => hold({ startsAt: at(11, 30) })).toThrow(ValidationError) // 11:30 + 60 > 12:00
      expect(() => hold({ startsAt: Number.NaN })).toThrow(ValidationError)
      expect(() => hold({ durationMinutes: 50 })).toThrow(ValidationError)
      expect(() => hold({ durationMinutes: 300 })).toThrow(ValidationError)
      expect(() => hold({ windowEndsAt: at(8) })).toThrow(ValidationError)
      expect(() => hold({ windowStartsAt: at(8, 10) })).toThrow(ValidationError)
      const preview = previewHoldOp(
        db,
        caller,
        { professionalId: pro.id, windowStartsAt: at(8), windowEndsAt: at(12), durationMinutes: 60 },
        clock,
      )
      expect(preview).toMatchObject({ freeMinutes: 240, fits: true })
    } finally {
      close()
    }
  })
})
