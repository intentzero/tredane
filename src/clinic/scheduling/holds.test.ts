import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ConflictError, ValidationError, ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { STATEMENTS as M16 } from '../migrations/0016_schedule_holds'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { getOpportunityOp, moveOpportunityStageOp } from '../pipeline'
import {
  cancelHoldOp,
  checkSlotAvailabilityOp,
  confirmAppointmentOp,
  createHoldOp,
  dismissHoldAlertOp,
  listHoldAlertsOp,
  listHoldsOp,
  previewHoldOp,
  queryAgendaViewOp,
  queryAvailabilityOp,
  resolveHoldOp,
  sweepExpiredHoldsOp,
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
        confirmBy: at(0) - 1,
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

describe('reserva por bloco', () => {
  it('migração 16: etapa a_definir aceita, tabela criada, FKs íntegras', () => {
    const { db, close } = setup()
    try {
      const fk = db.all(`PRAGMA foreign_key_check`)
      expect(fk).toEqual([])
      const t = db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%__m16'`,
      )
      expect(t).toEqual([])
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

  it('migração 16 preserva oportunidades e histórico ao reconstruir', () => {
    const { db, close, hold, caller, clock } = setup()
    try {
      const h = hold()
      const before = db.all(`SELECT * FROM opportunities ORDER BY id`)
      const hist = db.all(`SELECT * FROM opportunity_stage_history ORDER BY id`)
      db.transactionSync(() => {
        for (const sql of M16.filter((x) => !x.includes(' schedule_holds') && !x.includes('idx_schedule_holds'))) db.run(sql)
      })
      expect(db.all(`SELECT * FROM opportunities ORDER BY id`)).toEqual(before)
      expect(db.all(`SELECT * FROM opportunity_stage_history ORDER BY id`)).toEqual(hist)
      expect(db.all(`PRAGMA foreign_key_check`)).toEqual([])
      expect(getOpportunityOp(db, caller, h.value.opportunityId!, clock).stage).toBe('a_definir')
    } finally {
      close()
    }
  })

  it('reservar: contato vai para «A definir», bloco aparece na agenda', () => {
    const { db, close, caller, clock, hold, pro } = setup()
    try {
      const preview = previewHoldOp(
        db,
        caller,
        { professionalId: pro.id, windowStartsAt: at(8), windowEndsAt: at(12), durationMinutes: 60 },
        clock,
      )
      expect(preview).toMatchObject({ freeMinutes: 240, fits: true })
      const r = hold()
      expect(r.value.status).toBe('active')
      expect(r.value.responsibleClerkUserId).toBe(ACTOR)
      expect(r.outbox.map((o) => o.type)).toContain('schedule_hold.created')
      const opp = getOpportunityOp(db, caller, r.value.opportunityId!, clock)
      expect(opp.stage).toBe('a_definir')
      expect(opp.openHold?.id).toBe(r.value.id)
      expect(opp.history.map((x) => x.toStage)).toContain('a_definir')
      const agenda = queryAgendaViewOp(db, caller, { date: '2024-01-08', view: 'day' }, clock)
      expect(agenda.holds.map((h) => h.id)).toEqual([r.value.id])
      expect(agenda.appointments).toEqual([])
    } finally {
      close()
    }
  })

  it('idempotente por clientRequestId; uma reserva activa por conversa', () => {
    const { close, hold } = setup()
    try {
      const a = hold({ clientRequestId: 'same' })
      const b = hold({ clientRequestId: 'same' })
      expect(b.idempotentReplay).toBe(true)
      expect(b.value.id).toBe(a.value.id)
      expect(() => hold()).toThrow(ConflictError)
    } finally {
      close()
    }
  })

  it('só ocupa a duração: outros horários livres até o bloco deixar de caber', () => {
    const { db, close, caller, clock, hold, book, svc, pro } = setup()
    try {
      const h = hold()
      book(8)
      book(9)
      book(10)
      // 11:00 é o único espaço que resta para o bloco de 1 h.
      expect(() => book(11)).toThrow(ConflictError)
      const check = checkSlotAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, professionalId: pro.id, startsAt: at(11) },
        clock,
      )
      expect(check.reasons).toEqual(['hold_conflict'])
      // Fora do período o bloco não interfere.
      expect(book(14).value.status).toBe('confirmed')
      const avail = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: '2024-01-08', professionalId: pro.id },
        clock,
      )
      expect(avail.slots.some((s) => s.startsAt === at(11))).toBe(false)
      const own = queryAvailabilityOp(
        db,
        caller,
        { serviceId: svc.id, date: '2024-01-08', professionalId: pro.id, excludeHoldId: h.value.id },
        clock,
      )
      expect(own.slots.some((s) => s.startsAt === at(11))).toBe(true)
    } finally {
      close()
    }
  })

  it('recusa reservar quando não cabe (nada é criado)', () => {
    const { db, close, caller, clock, hold, book, pro } = setup()
    try {
      book(8)
      book(9)
      book(10)
      const p = previewHoldOp(
        db,
        caller,
        { professionalId: pro.id, windowStartsAt: at(8), windowEndsAt: at(12), durationMinutes: 90 },
        clock,
      )
      expect(p).toMatchObject({ freeMinutes: 60, fits: false })
      expect(() => hold({ durationMinutes: 90 })).toThrow(ConflictError)
      expect(listHoldsOp(db, caller, {}, clock)).toEqual([])
    } finally {
      close()
    }
  })

  it('valida período e duração', () => {
    const { close, hold } = setup()
    try {
      expect(() => hold({ durationMinutes: 50 })).toThrow(ValidationError)
      expect(() => hold({ durationMinutes: 300 })).toThrow(ValidationError)
      expect(() => hold({ windowEndsAt: at(8) })).toThrow(ValidationError)
      expect(() => hold({ windowStartsAt: at(8, 10) })).toThrow(ValidationError)
    } finally {
      close()
    }
  })

  it('definir hora: cria compromisso, contato vai para «Agendado»', () => {
    const { db, close, caller, clock, hold, book } = setup()
    try {
      const h = hold()
      book(8)
      book(9)
      book(10)
      expect(() =>
        resolveHoldOp(
          db,
          caller,
          { holdId: h.value.id, clientRequestId: 'r-out', startsAt: at(12), actorClerkUserId: ACTOR },
          clock,
        ),
      ).toThrow(ValidationError)
      const r = resolveHoldOp(
        db,
        caller,
        { holdId: h.value.id, clientRequestId: 'r-1', startsAt: at(11), actorClerkUserId: ACTOR },
        clock,
      )
      expect(r.value.hold.status).toBe('resolved')
      expect(r.value.appointment.status).toBe('confirmed')
      expect(r.value.appointment.conversationId).toBe(h.value.conversationId)
      const opp = getOpportunityOp(db, caller, h.value.opportunityId!, clock)
      expect(opp.stage).toBe('agendado')
      expect(opp.linkedAppointment?.id).toBe(r.value.appointment.id)
      expect(opp.openHold).toBeNull()
      const replay = resolveHoldOp(
        db,
        caller,
        { holdId: h.value.id, clientRequestId: 'r-1', startsAt: at(11), actorClerkUserId: ACTOR },
        clock,
      )
      expect(replay.idempotentReplay).toBe(true)
    } finally {
      close()
    }
  })

  it('aviso <48 h, vencimento volta a «A definir» e aviso dispensável', () => {
    const { db, close, caller, clock, hold, tenantId } = setup()
    try {
      const h = hold()
      expect(listHoldAlertsOp(db, caller, clock)).toEqual([])
      clock.set(at(8) - 18 * 3600_000)
      const soon = listHoldAlertsOp(db, caller, clock)
      expect(soon.map((a) => a.kind)).toEqual(['starts_soon'])
      // Atendente mexeu a etapa entretanto.
      moveOpportunityStageOp(
        db,
        caller,
        { opportunityId: h.value.opportunityId!, toStage: 'em_atendimento', actorClerkUserId: ACTOR, actorDisplayName: 'A' },
        clock,
      )
      clock.set(at(12))
      const swept = sweepExpiredHoldsOp(db, caller, clock)
      expect(swept.value.map((x) => x.status)).toEqual(['expired'])
      expect(swept.outbox.map((o) => o.type)).toContain('schedule_hold.expired')
      expect(getOpportunityOp(db, caller, h.value.opportunityId!, clock).stage).toBe('a_definir')
      expect(sweepExpiredHoldsOp(db, caller, clock).value).toEqual([])
      const alerts = listHoldAlertsOp(db, caller, clock)
      expect(alerts.map((a) => a.kind)).toEqual(['expired'])
      dismissHoldAlertOp(db, caller, { holdId: h.value.id, actorClerkUserId: ACTOR }, clock)
      expect(listHoldAlertsOp(db, caller, clock)).toEqual([])
      expect(tenantId).toBe('clinic-demo-a')
    } finally {
      close()
    }
  })

  it('cancelar volta para «Em atendimento»; fechar o contato cancela o bloco', () => {
    const { db, close, caller, clock, hold, ingest, svc, pro } = setup()
    try {
      const h = hold()
      cancelHoldOp(db, caller, { holdId: h.value.id, actorClerkUserId: ACTOR }, clock)
      expect(getOpportunityOp(db, caller, h.value.opportunityId!, clock).stage).toBe('em_atendimento')

      const conv2 = ingest(2)
      const h2 = createHoldOp(
        db,
        caller,
        {
          clientRequestId: 'h2',
          conversationId: conv2.id,
          serviceId: svc.id,
          professionalId: pro.id,
          durationMinutes: 60,
          windowStartsAt: at(13),
          windowEndsAt: at(18),
          actorClerkUserId: ACTOR,
        },
        clock,
      )
      moveOpportunityStageOp(
        db,
        caller,
        { opportunityId: h2.value.opportunityId!, toStage: 'perdido', actorClerkUserId: ACTOR, actorDisplayName: 'A' },
        clock,
      )
      expect(listHoldsOp(db, caller, { statuses: ['cancelled'] }, clock).map((x) => x.id).sort()).toEqual(
        [h.value.id, h2.value.id].sort(),
      )
    } finally {
      close()
    }
  })
})
