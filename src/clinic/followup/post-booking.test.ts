/**
 * DEC-086 — follow-up pós-agendamento.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from '../inbox/templates'
import { findOpenOpportunityForConversation } from '../pipeline'
import { ensureOpenOpportunity } from '../pipeline/operations'
import {
  ANOTHER_REPLY_BODY,
  handlePostBookingButtonClick,
  parsePostBookingButtonId,
  postBookingButtonId,
  POST_BOOKING_BODY,
  sendPostBookingFollowupOp,
  THANKS_REPLY_BODY,
} from './post-booking'
import { getScheduleSession, saveScheduleSession } from '../ai/schedule-session'

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
        { serviceId: 'svc_fu', dayLabel: 'amanhã', period: 'tarde' },
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
})
