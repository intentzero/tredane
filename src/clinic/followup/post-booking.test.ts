/**
 * DEC-086 — follow-up pós-agendamento.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from '../inbox/templates'
import { insertMessage } from '../inbox/messages'
import { findOpenOpportunityForConversation } from '../pipeline'
import { ensureOpenOpportunity } from '../pipeline/operations'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { tryAiAutoBook } from '../ai/autobook'
import {
  ANOTHER_REPLY_BODY,
  handlePostBookingButtonClick,
  parsePostBookingButtonId,
  postBookingButtonId,
  POST_BOOKING_BODY,
  sendPostBookingFollowupOp,
  THANKS_REPLY_BODY,
} from './post-booking'
import { getBookingFrame, getScheduleSession, saveBookingFrame, saveScheduleSession } from '../ai/schedule-session'

const TZ = 'America/Sao_Paulo'
const STALE_SLOT = /nesse horário das 15:00|15:00 já não tenho vaga|às 15:00 já está ocupado|próximo com vaga/i

function connectWa(db: ReturnType<typeof bootClinicDb>['db'], clock: ReturnType<typeof createControllableClock>) {
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

describe('DEC-086 post-booking follow-up', () => {
  it('parseia ids de botão', () => {
    expect(parsePostBookingButtonId(postBookingButtonId('apt_1', 'thanks'))).toEqual({
      appointmentId: 'apt_1',
      action: 'thanks',
    })
    expect(parsePostBookingButtonId('prop:x:v1:confirm')).toBeNull()
  })

  it('envia pergunta com botões e «Não, obrigado» agradece sem mudar a etapa', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 31, 16))
    const { db, close } = bootClinicDb({ clock })
    try {
      connectWa(db, clock)
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:fu:1',
          waId: '5511987001888',
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
      // Avança para agendado (simula pós-confirmação).
      const opp = findOpenOpportunityForConversation(db, 'clinic-demo-a', conversationId)!
      db.run(
        `UPDATE opportunities SET stage = 'agendado', updated_at = ? WHERE tenant_id = ? AND id = ?`,
        clock.nowMs(),
        'clinic-demo-a',
        opp.id,
      )

      const sent = sendPostBookingFollowupOp(
        db,
        caller,
        { conversationId, appointmentId: 'apt_fu_1' },
        clock,
      )
      expect(sent.status).toBe('queued')
      if (sent.status !== 'queued') return
      expect(sent.duplicate).toBe(false)

      const msg = db.get<{ body: string }>(
        `SELECT body FROM messages WHERE id = ?`,
        sent.messageId,
      )
      expect(msg?.body).toBe(POST_BOOKING_BODY)

      const ob = db.get<{ interactive_json: string | null }>(
        `SELECT interactive_json FROM outbound_messages WHERE id = ?`,
        sent.outboundId,
      )
      expect(ob?.interactive_json).toContain('Não, obrigado')
      expect(ob?.interactive_json).toContain('Quero outro serviço')

      const again = sendPostBookingFollowupOp(
        db,
        caller,
        { conversationId, appointmentId: 'apt_fu_1' },
        clock,
      )
      expect(again.status).toBe('queued')
      if (again.status === 'queued') expect(again.duplicate).toBe(true)

      // Simula badge a chamar a atendente (mensagem inbound / clique WA).
      db.run(
        `UPDATE conversations SET unread_count = 3, updated_at = ? WHERE tenant_id = ? AND id = ?`,
        clock.nowMs(),
        'clinic-demo-a',
        conversationId,
      )

      const click = handlePostBookingButtonClick(
        db,
        {
          tenantId: 'clinic-demo-a',
          conversationId,
          buttonId: postBookingButtonId('apt_fu_1', 'thanks'),
          providerEventKey: 'wa:fu:thanks',
        },
        clock,
      )
      expect(click.handled).toBe(true)
      if (!click.handled || click.action !== 'thanks') return
      expect(click.closedOpportunityId).toBeNull()
      expect(click.outbox.some((row) => row.type === 'conversation.read')).toBe(true)

      const unread = db.get<{ unread_count: number; status: string }>(
        `SELECT unread_count, status FROM conversations WHERE id = ?`,
        conversationId,
      )
      expect(unread?.unread_count).toBe(0)
      // Encerrar (status closed) fica fora deste recorte — só o badge some.
      expect(unread?.status).not.toBe('closed')

      const closed = db.get<{ stage: string; status: string }>(
        `SELECT stage, status FROM opportunities WHERE id = ?`,
        opp.id,
      )
      expect(closed).toEqual({ stage: 'agendado', status: 'open' })

      const thanksBody = db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC LIMIT 1`,
        'clinic-demo-a',
        conversationId,
      )
      expect(thanksBody?.body).toBe(THANKS_REPLY_BODY)
    } finally {
      close()
    }
  })

  it('«Quero outro serviço» limpa a sessão e mantém o ciclo aberto', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 31, 16, 30))
    const { db, close } = bootClinicDb({ clock })
    try {
      connectWa(db, clock)
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:fu:2',
          waId: '5511987001777',
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
      const opp = findOpenOpportunityForConversation(db, 'clinic-demo-a', conversationId)!
      db.run(
        `UPDATE opportunities SET stage = 'agendado', updated_at = ? WHERE tenant_id = ? AND id = ?`,
        clock.nowMs(),
        'clinic-demo-a',
        opp.id,
      )
      // Sessão fictícia de serviço.
      db.run(
        `INSERT OR IGNORE INTO services (id, tenant_id, name, duration_minutes, buffer_minutes, active, created_at, updated_at)
         VALUES ('svc_fu', 'clinic-demo-a', 'Limpeza', 60, 0, 1, ?, ?)`,
        clock.nowMs(),
        clock.nowMs(),
      )
      saveScheduleSession(
        db,
        'clinic-demo-a',
        conversationId,
        {
          serviceId: 'svc_fu',
          dayLabel: 'amanhã',
          period: 'tarde',
          date: '2026-11-05',
          clockTime: '15:00',
        },
        clock,
      )
      expect(getScheduleSession(db, 'clinic-demo-a', conversationId)?.serviceId).toBe('svc_fu')

      sendPostBookingFollowupOp(
        db,
        caller,
        { conversationId, appointmentId: 'apt_fu_2' },
        clock,
      )

      const click = handlePostBookingButtonClick(
        db,
        {
          tenantId: 'clinic-demo-a',
          conversationId,
          buttonId: postBookingButtonId('apt_fu_2', 'another'),
          providerEventKey: 'wa:fu:another',
        },
        clock,
      )
      expect(click.handled).toBe(true)
      if (!click.handled || click.action !== 'another') return

      expect(getScheduleSession(db, 'clinic-demo-a', conversationId)).toBeNull()
      expect(getBookingFrame(db, 'clinic-demo-a', conversationId)).toBeNull()
      const stillOpen = findOpenOpportunityForConversation(db, 'clinic-demo-a', conversationId)
      expect(stillOpen?.id).toBe(opp.id)
      expect(stillOpen?.stage).toBe('agendado')

      const ask = db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC LIMIT 1`,
        'clinic-demo-a',
        conversationId,
      )
      expect(ask?.body).toBe(ANOTHER_REPLY_BODY)
    } finally {
      close()
    }
  })

  it('«Não, obrigado» fecha o funil: cumprimento seguinte não retoma as 15:00 e o horário fica', async () => {
    const clock = createControllableClock(zonedCivilToUtc(TZ, 2026, 11, 4, 14, 37))
    const { db, close } = bootClinicDb({ clock })
    try {
      connectWa(db, clock)
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const room = upsertResourceOp(
        db,
        caller,
        { kind: 'room', name: 'Sala', category: 'Sala' },
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
          name: 'Depilacao',
          durationMinutes: 105,
          bufferMinutes: 0,
          priceCents: 18000,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      const week = [1, 2, 3, 4, 5].map((d) => ({
        dayOfWeek: d,
        startMinute: 9 * 60,
        endMinute: 18 * 60,
      }))
      setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
      setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)

      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:fu:stale',
          waId: '5511987001666',
          body: 'quero depilacao quarta 15:00',
        },
        clock,
      )
      const conversationId = ingested.conversation!.id
      const contactId = ingested.contact!.id
      const opened = ensureOpenOpportunity(
        db,
        { tenantId: 'clinic-demo-a', contactId, conversationId },
        clock,
      )
      const opp = opened.opportunity
      const startsAt = zonedCivilToUtc(TZ, 2026, 11, 4, 15, 0)
      const booked = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-fu-stale-15',
          serviceId: svc.id,
          professionalId: pro.id,
          startsAt,
          contactId,
          conversationId,
          opportunityId: opp.id,
          actorClerkUserId: caller.actorId!,
          contactLabel: 'Cliente Ficticia',
        },
        clock,
      )
      expect(booked.value.status).toBe('confirmed')
      expect(booked.value.endsAt - booked.value.startsAt).toBe(105 * 60_000)

      const offer = insertMessage(
        db,
        {
          tenantId: 'clinic-demo-a',
          conversationId,
          direction: 'outbound',
          body: 'Na quarta tenho 15:00. Qual fica melhor?',
          deliveryState: 'delivered',
          createdAt: clock.nowMs(),
        },
        clock,
      )
      clock.advance(1_000)
      saveBookingFrame(
        db,
        'clinic-demo-a',
        conversationId,
        {
          serviceId: svc.id,
          date: '2026-11-04',
          time: '15:00',
          phase: 'proposto',
          pending: {
            slot: 'horario',
            options: [
              { key: '2026-11-04T15:00', label: 'quarta 04/11 15:00' },
              { key: '2026-11-05T13:00', label: 'quinta 05/11 13:00' },
            ],
            messageId: offer.id,
          },
          lastOffer: {
            slots: [{ startsAt, professionalId: pro.id }],
            messageId: offer.id,
          },
        },
        clock,
      )
      expect(getBookingFrame(db, 'clinic-demo-a', conversationId)?.time).toBe('15:00')

      sendPostBookingFollowupOp(
        db,
        caller,
        { conversationId, appointmentId: booked.value.id },
        clock,
      )
      db.run(
        `UPDATE conversations SET unread_count = 2, updated_at = ? WHERE tenant_id = ? AND id = ?`,
        clock.nowMs(),
        'clinic-demo-a',
        conversationId,
      )
      const click = handlePostBookingButtonClick(
        db,
        {
          tenantId: 'clinic-demo-a',
          conversationId,
          buttonId: postBookingButtonId(booked.value.id, 'thanks'),
          providerEventKey: 'wa:fu:thanks:stale',
        },
        clock,
      )
      expect(click.handled).toBe(true)
      if (!click.handled || click.action !== 'thanks') return
      expect(click.closedOpportunityId).toBeNull()
      expect(click.outbox.some((row) => row.type === 'booking_frame.updated')).toBe(true)
      expect(click.outbox.some((row) => row.type === 'conversation.read')).toBe(true)
      expect(getBookingFrame(db, 'clinic-demo-a', conversationId)).toBeNull()
      const unreadAfter = db.get<{ unread_count: number }>(
        `SELECT unread_count FROM conversations WHERE id = ?`,
        conversationId,
      )
      expect(unreadAfter?.unread_count).toBe(0)

      const stage = findOpenOpportunityForConversation(db, 'clinic-demo-a', conversationId)
      expect(stage?.id).toBe(opp.id)
      expect(stage?.stage).toBe('agendado')
      const apt = db.get<{ id: string; status: string }>(
        `SELECT id, status FROM appointments WHERE tenant_id = ? AND id = ?`,
        'clinic-demo-a',
        booked.value.id,
      )
      expect(apt).toEqual({ id: booked.value.id, status: 'confirmed' })

      const forecast = {
        async read() {
          return { ok: true as const, sky: 'ceu_limpo' as const, celsius: 26 }
        },
      }
      clock.advance(48 * 60_000)
      for (const greeting of ['Oi oi tudo bem?', 'oi']) {
        insertMessage(
          db,
          {
            tenantId: 'clinic-demo-a',
            conversationId,
            direction: 'inbound',
            body: greeting,
            deliveryState: 'received',
            createdAt: clock.nowMs(),
          },
          clock,
        )
        const out = await tryAiAutoBook(db, caller, clock, {
          conversationId,
          capability: true,
          forecast,
        })
        expect(out.replyText ?? '', greeting).not.toMatch(STALE_SLOT)
        expect(out.replyText ?? '', greeting).not.toMatch(/\b15:00\b/)
        expect(getBookingFrame(db, 'clinic-demo-a', conversationId)?.time ?? null).toBeNull()
        clock.advance(60_000)
      }

      const still = db.get<{ id: string; status: string }>(
        `SELECT id, status FROM appointments WHERE tenant_id = ? AND id = ?`,
        'clinic-demo-a',
        booked.value.id,
      )
      expect(still).toEqual({ id: booked.value.id, status: 'confirmed' })
      const n = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND status = 'confirmed'`,
        'clinic-demo-a',
      )
      expect(n?.n).toBe(1)
      expect(findOpenOpportunityForConversation(db, 'clinic-demo-a', conversationId)?.stage).toBe(
        'agendado',
      )
    } finally {
      close()
    }
  })
})
