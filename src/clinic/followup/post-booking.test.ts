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
  handlePostBookingButtonClick,
  parsePostBookingButtonId,
  postBookingButtonId,
  POST_BOOKING_BODY,
  sendPostBookingFollowupOp,
} from './post-booking'
import { isTerminarFarewellBody } from './terminar-farewell'
import { getScheduleSession, saveScheduleSession } from '../ai/schedule-session'
import { HANDOFF_TIMEOUT_MS } from '../constants'
import {
  HANDOFF_TIMEOUT_RESUME_TEXT,
  notifyHumanHandoff,
  readAiReplyPause,
  readHandoffTimeoutAt,
  sweepDueHandoffTimeouts,
} from '../ai/human-handoff'
import { assignConversationOp, sendOutboundMessageOp } from '../inbox/operations'
import {
  IDLE_PROMPT_AFTER_MS,
  IDLE_PROMPT_BODY,
  sweepDueIdleConversations,
} from './idle'

const TZ = 'America/Sao_Paulo'
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
    expect(parsePostBookingButtonId(postBookingButtonId('apt_1', 'end'))).toEqual({
      appointmentId: 'apt_1',
      action: 'end',
    })
    expect(parsePostBookingButtonId('prop:x:v1:confirm')).toBeNull()
  })

  it('envia pergunta com botões e «Terminar» fecha a sessão (Class A)', () => {
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
      expect(ob?.interactive_json).toContain('Terminar')
      expect(ob?.interactive_json).toContain('Marcar outro')

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
          buttonId: postBookingButtonId('apt_fu_1', 'end'),
          providerEventKey: 'wa:fu:end',
        },
        clock,
      )
      expect(click.handled).toBe(true)
      if (!click.handled || click.action !== 'end') return
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
      // Class A — adeus Terminar (3 frases; Paulo 13/11/2026).
      expect(isTerminarFarewellBody(thanksBody?.body ?? '', TZ, clock.nowMs())).toBe(true)
    } finally {
      close()
    }
  })

  it('«Marcar outro» mantém o ciclo aberto e não envia nada pelo próprio handler (DEC-202)', () => {
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

      // DEC-202: o clique não abre catálogo no chat; quem o trata envia o link «Abrir agenda».
      expect(click.outbox).toEqual([])
      const stillOpen = findOpenOpportunityForConversation(db, 'clinic-demo-a', conversationId)
      expect(stillOpen?.id).toBe(opp.id)
      expect(stillOpen?.stage).toBe('agendado')

    } finally {
      close()
    }
  })

  it('Terminar cancela handoff DEC-155 e idle — sem «equipe não conseguiu» / «Ainda está aí?»', () => {
    // Staging: Agendado + Terminar com pausa DEC-083 aberta → +30 min handoff-fail
    // e +60 min idle. Confirmar funciona com IA pausada; Terminar tem de limpar.
    const clock = createControllableClock(Date.UTC(2026, 10, 13, 12, 11))
    const { db, close } = bootClinicDb({ clock })
    try {
      connectWa(db, clock)
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:fu:terminar-suppress',
          waId: '5511987001999',
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

      const handoff = notifyHumanHandoff(
        db,
        'clinic-demo-a',
        {
          conversationId,
          reason: 'customer_requested',
          clientRequestId: 'wa:fu:terminar-suppress:handoff',
        },
        clock,
      )
      expect(handoff.already).toBe(false)
      expect(readAiReplyPause(db, 'clinic-demo-a', conversationId)?.at).not.toBeNull()
      const scheduledHandoffAt = clock.nowMs() + HANDOFF_TIMEOUT_MS
      expect(readHandoffTimeoutAt(db, 'clinic-demo-a', conversationId)).toBe(scheduledHandoffAt)

      sendPostBookingFollowupOp(
        db,
        caller,
        { conversationId, appointmentId: 'apt_fu_terminar' },
        clock,
      )

      const click = handlePostBookingButtonClick(
        db,
        {
          tenantId: 'clinic-demo-a',
          conversationId,
          buttonId: postBookingButtonId('apt_fu_terminar', 'end'),
          providerEventKey: 'wa:fu:terminar-suppress:end',
        },
        clock,
      )
      expect(click.handled).toBe(true)
      expect(readAiReplyPause(db, 'clinic-demo-a', conversationId)).toBeNull()
      expect(readHandoffTimeoutAt(db, 'clinic-demo-a', conversationId)).toBeNull()
      const idleRow = db.get<{ due: number | null; phase: string | null; assignee: string | null }>(
        `SELECT idle_due_at AS due, idle_phase AS phase, assignee_clerk_user_id AS assignee
         FROM conversations WHERE id = ?`,
        conversationId,
      )
      expect(idleRow?.due).toBeNull()
      expect(idleRow?.phase).toBeNull()
      expect(idleRow?.assignee).toBe('system:ai-autodraft')

      clock.advance(HANDOFF_TIMEOUT_MS + 1)
      // Simula o alarme DO a disparar no timestamp antigo do handoff (órfão).
      expect(clock.nowMs()).toBeGreaterThanOrEqual(scheduledHandoffAt)
      expect(sweepDueHandoffTimeouts(db, 'clinic-demo-a', clock)).toHaveLength(0)
      clock.advance(IDLE_PROMPT_AFTER_MS)
      const idleSweep = sweepDueIdleConversations(db, 'clinic-demo-a', clock)
      expect(idleSweep.every((item) => item.action !== 'prompted')).toBe(true)

      const bodies = db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'`,
          'clinic-demo-a',
          conversationId,
        )
        .map((r) => r.body)
      expect(bodies).not.toContain(HANDOFF_TIMEOUT_RESUME_TEXT)
      expect(bodies).not.toContain(IDLE_PROMPT_BODY)
      expect(findOpenOpportunityForConversation(db, 'clinic-demo-a', conversationId)?.stage).toBe(
        'agendado',
      )
      // Corrida: alarme antigo + pausa/timeout reaparecem sem alerta (Terminar já resolveu).
      db.run(
        `UPDATE conversations
         SET ai_reply_paused_at = ?, ai_reply_pause_reason = 'customer_requested',
             ai_handoff_timeout_at = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`,
        scheduledHandoffAt - HANDOFF_TIMEOUT_MS,
        scheduledHandoffAt,
        clock.nowMs(),
        'clinic-demo-a',
        conversationId,
      )
      expect(sweepDueHandoffTimeouts(db, 'clinic-demo-a', clock)).toHaveLength(0)
      const bodiesAfterStale = db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'`,
          'clinic-demo-a',
          conversationId,
        )
        .map((r) => r.body)
      expect(bodiesAfterStale).not.toContain(HANDOFF_TIMEOUT_RESUME_TEXT)
    } finally {
      close()
    }
  })

  it('após Terminar, «Gratidão!» + resposta não rearma «Ainda está aí?» (Paulo 14/11)', () => {
    // Staging: Terminar → farewell → Gratidão! → De nada → ~15 min → nudge. Bug.
    const clock = createControllableClock(Date.UTC(2026, 10, 14, 12, 0))
    const { db, close } = bootClinicDb({ clock })
    try {
      connectWa(db, clock)
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:fu:gratidao-idle',
          waId: '5511987002001',
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

      sendPostBookingFollowupOp(
        db,
        caller,
        { conversationId, appointmentId: 'apt_fu_gratidao' },
        clock,
      )
      const click = handlePostBookingButtonClick(
        db,
        {
          tenantId: 'clinic-demo-a',
          conversationId,
          buttonId: postBookingButtonId('apt_fu_gratidao', 'end'),
          providerEventKey: 'wa:fu:gratidao-idle:end',
        },
        clock,
      )
      expect(click.handled).toBe(true)
      expect(
        db.get<{ at: number | null }>(
          `SELECT idle_suppressed_at AS at FROM conversations WHERE id = ?`,
          conversationId,
        )?.at,
      ).not.toBeNull()
      expect(
        db.get<{ due: number | null }>(
          `SELECT idle_due_at AS due FROM conversations WHERE id = ?`,
          conversationId,
        )?.due,
      ).toBeNull()

      clock.advance(60_000)
      ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:fu:gratidao-idle:thanks',
          waId: '5511987002001',
          body: 'Gratidão!',
        },
        clock,
      )
      sendOutboundMessageOp(
        db,
        workerCaller('clinic-demo-a', 'system:ai-autodraft'),
        {
          conversationId,
          body: 'De nada! Se precisar, é só chamar.',
          clientRequestId: 'wa:fu:gratidao-idle:reply',
          authorClerkUserId: 'system:ai-autodraft',
          authorDisplayName: 'IA',
        },
        clock,
      )

      expect(
        db.get<{ due: number | null }>(
          `SELECT idle_due_at AS due FROM conversations WHERE id = ?`,
          conversationId,
        )?.due,
      ).toBeNull()

      clock.advance(IDLE_PROMPT_AFTER_MS + 1)
      const sweep = sweepDueIdleConversations(db, 'clinic-demo-a', clock)
      expect(sweep.every((item) => item.action !== 'prompted')).toBe(true)
      const bodies = db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'`,
          'clinic-demo-a',
          conversationId,
        )
        .map((r) => r.body)
      expect(bodies).not.toContain(IDLE_PROMPT_BODY)
    } finally {
      close()
    }
  })

  it('após Assumir, Terminar pós-agendamento devolve a conversa à IA', () => {
    const clock = createControllableClock(Date.UTC(2026, 10, 13, 13, 0))
    const { db, close } = bootClinicDb({ clock })
    try {
      connectWa(db, clock)
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:fu:terminar-after-assumir',
          waId: '5511987001770',
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
      notifyHumanHandoff(
        db,
        'clinic-demo-a',
        {
          conversationId,
          reason: 'customer_requested',
          clientRequestId: 'wa:fu:terminar-after-assumir:handoff',
        },
        clock,
      )
      assignConversationOp(
        db,
        caller,
        {
          conversationId,
          assigneeClerkUserId: 'user_synth_attendant_a',
          assigneeDisplayName: 'Ana',
          actorClerkUserId: 'user_synth_attendant_a',
          actorDisplayName: 'Ana',
        },
        clock,
      )
      expect(readAiReplyPause(db, 'clinic-demo-a', conversationId)?.at).not.toBeNull()
      expect(readHandoffTimeoutAt(db, 'clinic-demo-a', conversationId)).toBeNull()

      sendPostBookingFollowupOp(
        db,
        caller,
        { conversationId, appointmentId: 'apt_fu_assumir' },
        clock,
      )
      const click = handlePostBookingButtonClick(
        db,
        {
          tenantId: 'clinic-demo-a',
          conversationId,
          buttonId: postBookingButtonId('apt_fu_assumir', 'end'),
          providerEventKey: 'wa:fu:terminar-after-assumir:end',
        },
        clock,
      )
      expect(click.handled).toBe(true)
      expect(readAiReplyPause(db, 'clinic-demo-a', conversationId)?.reason).toBe('staff_active')
      expect(
        db.get<{ a: string | null }>(
          `SELECT assignee_clerk_user_id AS a FROM conversations WHERE id = ?`,
          conversationId,
        )?.a,
      ).toBe('user_synth_attendant_a')
    } finally {
      close()
    }
  })
})
