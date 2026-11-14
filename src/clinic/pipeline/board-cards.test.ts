import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { openBookingSessionIfNeeded, endBookingSession } from '../ai/booking-session'
import {
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { upsertContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { workerCaller } from '../index'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { ensureOpenOpportunity, listOpportunitiesOp, moveOpportunityStageOp } from './index'

const TZ = 'America/Sao_Paulo'

function seedClinic(db: ReturnType<typeof bootClinicDb>['db'], clock: ReturnType<typeof createControllableClock>) {
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
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: room.id,
      windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
    },
    clock,
  )
  return { tenantId, caller, pro, room, svc }
}

describe('DEC-187 — cartão gémeo de atendimento + merge Agendado', () => {
  it('com horário futuro e sessão de marcação aberta, projecta gémeo Em atendimento', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { tenantId, caller, pro, room, svc } = seedClinic(db, clock)
      const contact = upsertContact(
        db,
        { tenantId, waId: '5511900002222', displayName: 'Lia Dual' },
        clock,
      )
      const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
      const opp = ensureOpenOpportunity(
        db,
        { tenantId, contactId: contact.id, conversationId: cnv.id },
        clock,
      ).opportunity
      confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-dual-1',
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0),
          contactId: contact.id,
          conversationId: cnv.id,
          opportunityId: opp.id,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )

      const before = listOpportunitiesOp(db, caller, {}, clock)
      expect(before.items.filter((i) => i.id === opp.id)).toHaveLength(1)
      expect(before.items.find((i) => i.id === opp.id)?.stage).toBe('agendado')
      expect(before.counts.find((c) => c.stage === 'em_atendimento')?.count ?? 0).toBe(0)

      openBookingSessionIfNeeded(
        db,
        tenantId,
        cnv.id,
        {
          phase: 'coletando',
          serviceId: svc.id,
          line: null,
          variantIds: null,
          date: null,
          period: null,
          time: null,
          pending: null,
          lastOffer: null,
          proposal: null,
        },
        clock,
        { openReason: 'service_named' },
      )

      const dual = listOpportunitiesOp(db, caller, {}, clock)
      const cards = dual.items.filter((i) => i.id === opp.id)
      expect(cards.map((c) => c.cardKind).sort()).toEqual(['cycle', 'open_attendance'])
      const twin = cards.find((c) => c.cardKind === 'open_attendance')!
      expect(twin.stage).toBe('em_atendimento')
      expect(twin.boardKey).toBe(`${opp.id}:attendance`)
      expect(twin.futureAppointmentCount).toBe(1)
      const cycle = cards.find((c) => c.cardKind === 'cycle')!
      expect(cycle.stage).toBe('agendado')
      expect(cycle.futureAppointmentCount).toBe(1)
      expect(dual.counts.find((c) => c.stage === 'em_atendimento')?.count).toBeGreaterThanOrEqual(1)
      expect(dual.counts.find((c) => c.stage === 'agendado')?.count).toBeGreaterThanOrEqual(1)

      const onlyEarly = listOpportunitiesOp(db, caller, { stage: 'em_atendimento' }, clock)
      expect(onlyEarly.items.some((i) => i.boardKey === `${opp.id}:attendance`)).toBe(true)
    } finally {
      close()
    }
  })

  it('ao confirmar o segundo horário, o gémeo some (merge) e o Agendado mostra contagem 2', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { tenantId, caller, pro, room, svc } = seedClinic(db, clock)
      const contact = upsertContact(
        db,
        { tenantId, waId: '5511900003333', displayName: 'Mia Merge' },
        clock,
      )
      const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
      const opp = ensureOpenOpportunity(
        db,
        { tenantId, contactId: contact.id, conversationId: cnv.id },
        clock,
      ).opportunity
      confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-merge-1',
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0),
          contactId: contact.id,
          conversationId: cnv.id,
          opportunityId: opp.id,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      openBookingSessionIfNeeded(
        db,
        tenantId,
        cnv.id,
        {
          phase: 'coletando',
          serviceId: svc.id,
          line: null,
          variantIds: null,
          date: null,
          period: null,
          time: null,
          pending: null,
          lastOffer: null,
          proposal: null,
        },
        clock,
        { openReason: 'intent' },
      )
      expect(
        listOpportunitiesOp(db, caller, {}, clock).items.filter((i) => i.id === opp.id),
      ).toHaveLength(2)

      // Segunda marcação: confirmAppointmentOp encerra a booking_session (merge).
      confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-merge-2',
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 11, 0),
          contactId: contact.id,
          conversationId: cnv.id,
          opportunityId: opp.id,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )

      const after = listOpportunitiesOp(db, caller, {}, clock)
      const cards = after.items.filter((i) => i.id === opp.id)
      expect(cards).toHaveLength(1)
      expect(cards[0]?.cardKind).toBe('cycle')
      expect(cards[0]?.stage).toBe('agendado')
      expect(cards[0]?.futureAppointmentCount).toBe(2)
      expect(after.items.some((i) => i.boardKey === `${opp.id}:attendance`)).toBe(false)
    } finally {
      close()
    }
  })

  it('sem sessão/proposta/quadro activo, Agendado sozinho não projecta gémeo', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, pro, room, svc, tenantId } = seedClinic(db, clock)
      const contact = upsertContact(
        db,
        { tenantId, waId: '5511900004444', displayName: 'Nia Só' },
        clock,
      )
      const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
      const opp = ensureOpenOpportunity(
        db,
        { tenantId, contactId: contact.id, conversationId: cnv.id },
        clock,
      ).opportunity
      confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-solo-1',
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0),
          contactId: contact.id,
          conversationId: cnv.id,
          opportunityId: opp.id,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      const listed = listOpportunitiesOp(db, caller, { stage: 'agendado' }, clock)
      const card = listed.items.find((i) => i.id === opp.id)
      expect(card?.cardKind).toBe('cycle')
      expect(card?.hasOpenAttendance).toBe(false)
      expect(card?.futureAppointmentCount).toBe(1)
      expect(listOpportunitiesOp(db, caller, { stage: 'em_atendimento' }, clock).items).toHaveLength(0)

      // Encerrar sessão explícita não deve reabrir gémeo.
      openBookingSessionIfNeeded(
        db,
        tenantId,
        cnv.id,
        {
          phase: 'coletando',
          serviceId: svc.id,
          line: null,
          variantIds: null,
          date: null,
          period: null,
          time: null,
          pending: null,
          lastOffer: null,
          proposal: null,
        },
        clock,
      )
      endBookingSession(db, tenantId, cnv.id, { outcome: 'abandon' }, clock)
      expect(
        listOpportunitiesOp(db, caller, {}, clock).items.filter((i) => i.id === opp.id),
      ).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('mover manual para Agendado sem compromisso não cria gémeo', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, tenantId } = seedClinic(db, clock)
      const contact = upsertContact(
        db,
        { tenantId, waId: '5511900005555', displayName: 'Oia Manual' },
        clock,
      )
      const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
      const opp = ensureOpenOpportunity(
        db,
        { tenantId, contactId: contact.id, conversationId: cnv.id },
        clock,
      ).opportunity
      moveOpportunityStageOp(
        db,
        caller,
        {
          opportunityId: opp.id,
          toStage: 'agendado',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Owner',
        },
        clock,
      )
      const listed = listOpportunitiesOp(db, caller, {}, clock)
      expect(listed.items.filter((i) => i.id === opp.id)).toHaveLength(1)
      expect(listed.items.find((i) => i.id === opp.id)?.missingAppointment).toBe(true)
      expect(listed.items.find((i) => i.id === opp.id)?.futureAppointmentCount).toBe(0)
    } finally {
      close()
    }
  })
})
