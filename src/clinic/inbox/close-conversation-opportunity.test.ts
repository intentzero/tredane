/**
 * Encerrar no painel: sem horário futuro → Perdido (parity Terminar / #989).
 * Com horário futuro → Agendado permanece; gémeo «Atendimento em curso» some.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from './templates'
import { AI_ACTOR_ID, AI_ACTOR_NAME } from '../ai-actor'
import { readAiReplyPause } from '../ai/human-handoff'
import {
  assignConversationOp,
  closeConversationOp,
  STAFF_CLOSE_CLIENT_BODY,
} from './operations'
import {
  ensureOpenOpportunity,
  findOpenOpportunityForConversation,
  listOpportunitiesOp,
} from '../pipeline'
import {
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { openBookingSessionIfNeeded } from '../ai/booking-session'

const TZ = 'America/Sao_Paulo'

function connectWa(
  db: ReturnType<typeof bootClinicDb>['db'],
  clock: ReturnType<typeof createControllableClock>,
) {
  syncWhatsappChannel(
    db,
    'clinic-demo-a',
    {
      status: 'connected',
      bindingId: 'b1',
      phoneNumberId: 'pn1',
      wabaId: 'w1',
      displayPhone: '+1555',
      action: 'channel_connected',
    },
    clock,
  )
  seedSyntheticWhatsappTemplates(db, 'clinic-demo-a', clock)
}

describe('closeConversationOp — oportunidade / Em atendimento', () => {
  it('Encerrar sem horário futuro move Em atendimento → Perdido', () => {
    const clock = createControllableClock(Date.UTC(2026, 10, 20, 19, 5))
    const { db, close } = bootClinicDb({ clock })
    try {
      connectWa(db, clock)
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:encerrar:no-future',
          waId: '5511987111001',
          displayName: 'Paulo',
          body: 'oi',
        },
        clock,
      )
      const conversationId = ingested.conversation!.id
      ensureOpenOpportunity(
        db,
        {
          tenantId: 'clinic-demo-a',
          contactId: ingested.contact!.id,
          conversationId,
        },
        clock,
      )
      db.run(
        `UPDATE opportunities SET stage = 'em_atendimento', updated_at = ? WHERE conversation_id = ?`,
        clock.nowMs(),
        conversationId,
      )
      const opp = findOpenOpportunityForConversation(db, 'clinic-demo-a', conversationId)!
      expect(opp.stage).toBe('em_atendimento')

      assignConversationOp(
        db,
        caller,
        {
          conversationId,
          assigneeClerkUserId: 'user_synth_owner_a',
          assigneeDisplayName: 'Paulo',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Paulo',
        },
        clock,
      )
      closeConversationOp(
        db,
        caller,
        {
          conversationId,
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Responsável',
        },
        clock,
      )

      expect(findOpenOpportunityForConversation(db, 'clinic-demo-a', conversationId)).toBeNull()
      const closed = db.get<{ stage: string; status: string }>(
        `SELECT stage, status FROM opportunities WHERE id = ?`,
        opp.id,
      )
      expect(closed).toEqual({ stage: 'perdido', status: 'closed' })
      expect(
        listOpportunitiesOp(db, caller, { stage: 'em_atendimento' }, clock).items,
      ).toHaveLength(0)

      // Paulo 20/11: aviso WhatsApp + devolve à IA (mesmo após Assumir).
      const outboundBodies = db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound'`,
          conversationId,
        )
        .map((r) => r.body)
      expect(outboundBodies).toContain(STAFF_CLOSE_CLIENT_BODY)
      expect(readAiReplyPause(db, 'clinic-demo-a', conversationId)).toBeNull()
      expect(
        db.get<{ a: string | null; d: string | null }>(
          `SELECT assignee_clerk_user_id AS a, assignee_display_name AS d FROM conversations WHERE id = ?`,
          conversationId,
        ),
      ).toMatchObject({ a: AI_ACTOR_ID, d: AI_ACTOR_NAME })
    } finally {
      close()
    }
  })

  it('Encerrar com horário futuro mantém Agendado e remove gémeo Atendimento em curso', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1, 12))
    const { db, close } = bootClinicDb({ clock })
    try {
      const tenantId = 'clinic-demo-a'
      const caller = workerCaller(tenantId, 'user_synth_owner_a')
      const room = upsertResourceOp(
        db,
        caller,
        { kind: 'room', name: 'Sala 1', category: 'Sala' },
        clock,
      )
      const pro = upsertResourceOp(
        db,
        caller,
        { kind: 'professional', name: 'Ana', homeRoomId: room.id },
        clock,
      )
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Massagem',
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
          windows: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }],
        },
        clock,
      )
      setWeeklyWindowsOp(
        db,
        caller,
        {
          resourceId: room.id,
          windows: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }],
        },
        clock,
      )
      connectWa(db, clock)
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:encerrar:future',
          waId: '5511987111002',
          displayName: 'Paulo',
          body: 'oi',
        },
        clock,
      )
      const conversationId = ingested.conversation!.id
      const contactId = ingested.contact!.id
      const opp = ensureOpenOpportunity(
        db,
        { tenantId, contactId, conversationId },
        clock,
      ).opportunity
      confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-encerrar-future',
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0),
          contactId,
          conversationId,
          opportunityId: opp.id,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      openBookingSessionIfNeeded(
        db,
        tenantId,
        conversationId,
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
      expect(
        listOpportunitiesOp(db, caller, {}, clock).items.filter((i) => i.id === opp.id),
      ).toHaveLength(2)

      assignConversationOp(
        db,
        caller,
        {
          conversationId,
          assigneeClerkUserId: 'user_synth_owner_a',
          assigneeDisplayName: 'Paulo',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Paulo',
        },
        clock,
      )
      closeConversationOp(
        db,
        caller,
        {
          conversationId,
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Responsável',
        },
        clock,
      )

      const still = findOpenOpportunityForConversation(db, tenantId, conversationId)
      expect(still?.stage).toBe('agendado')
      expect(still?.status).toBe('open')
      const cards = listOpportunitiesOp(db, caller, {}, clock).items.filter(
        (i) => i.id === opp.id,
      )
      expect(cards).toHaveLength(1)
      expect(cards[0]?.cardKind).toBe('cycle')
      expect(cards[0]?.hasOpenAttendance).toBe(false)
      expect(
        listOpportunitiesOp(db, caller, { stage: 'em_atendimento' }, clock).items.filter(
          (i) => i.id === opp.id,
        ),
      ).toHaveLength(0)
      expect(
        db
          .all<{ body: string }>(
            `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound'`,
            conversationId,
          )
          .map((r) => r.body),
      ).toContain(STAFF_CLOSE_CLIENT_BODY)
      expect(readAiReplyPause(db, tenantId, conversationId)).toBeNull()
      expect(
        db.get<{ a: string | null }>(
          `SELECT assignee_clerk_user_id AS a FROM conversations WHERE id = ?`,
          conversationId,
        )?.a,
      ).toBe(AI_ACTOR_ID)
    } finally {
      close()
    }
  })
})
