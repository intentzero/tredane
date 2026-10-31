/**
 * DEC-087 — idle 30 min + segundo prazo Proposto +30.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { ingestContactMessage, workerCaller } from '../index'
import { notifyHumanHandoff } from '../ai/human-handoff'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from '../inbox/templates'
import { findOpenOpportunityForConversation } from '../pipeline'
import { ensureOpenOpportunity } from '../pipeline/operations'
import { insertMessage } from '../inbox/messages'
import { touchConversationMessage } from '../inbox/conversations'
import {
  handleIdleButtonClick,
  IDLE_CLOSE_AFTER_MS,
  IDLE_PROMPT_AFTER_MS,
  IDLE_PROMPT_BODY,
  idleButtonId,
  parseIdleButtonId,
  rescheduleConversationIdle,
  sweepDueIdleConversations,
} from './idle'
import { THANKS_REPLY_BODY } from './post-booking'

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

describe('DEC-087 idle follow-up', () => {
  it('migração 46 e parse de botões', () => {
    expect(CLINIC_SCHEMA_VERSION).toBe(46)
    expect(parseIdleButtonId(idleButtonId('cnv_1', 'continue'))).toEqual({
      conversationId: 'cnv_1',
      action: 'continue',
    })
    expect(parseIdleButtonId('fu:post:x:thanks')).toBeNull()
  })

  it('após 30 min envia prompt; Terminar fecha em Concluído', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 31, 12))
    const { db, close } = bootClinicDb({ clock })
    try {
      connectWa(db, clock)
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:idle:1',
          waId: '5511987001666',
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
      const due = rescheduleConversationIdle(db, 'clinic-demo-a', conversationId, clock, {
        progressAt: clock.nowMs(),
      })
      expect(due).toBe(clock.nowMs() + IDLE_PROMPT_AFTER_MS)

      clock.advance(IDLE_PROMPT_AFTER_MS + 1)
      const swept = sweepDueIdleConversations(db, 'clinic-demo-a', clock)
      expect(swept.some((s) => s.action === 'prompted')).toBe(true)

      const prompt = db.get<{ body: string; phase: string | null; due: number | null }>(
        `SELECT m.body AS body, c.idle_phase AS phase, c.idle_due_at AS due
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.conversation_id = ? AND m.direction = 'outbound'
         ORDER BY m.created_at DESC LIMIT 1`,
        conversationId,
      )
      expect(prompt?.body).toBe(IDLE_PROMPT_BODY)
      expect(prompt?.phase).toBe('close')
      expect(prompt?.due).toBe(clock.nowMs() + IDLE_CLOSE_AFTER_MS)

      clock.advance(1_000)
      const click = handleIdleButtonClick(
        db,
        {
          tenantId: 'clinic-demo-a',
          conversationId,
          buttonId: idleButtonId(conversationId, 'end'),
          providerEventKey: 'wa:idle:end',
        },
        clock,
      )
      expect(click.handled).toBe(true)
      if (!click.handled || click.action !== 'end') return
      expect(click.closedOpportunityId).toBeTruthy()
      const opp = db.get<{ stage: string; status: string }>(
        `SELECT stage, status FROM opportunities WHERE conversation_id = ?`,
        conversationId,
      )
      expect(opp).toEqual({ stage: 'concluido', status: 'closed' })
      const thanks = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages
         WHERE conversation_id = ? AND direction = 'outbound' AND body = ?`,
        conversationId,
        THANKS_REPLY_BODY,
      )
      expect(thanks?.n).toBe(1)
    } finally {
      close()
    }
  })

  it('segundo prazo sem resposta fecha; system não reinicia; humano isenta', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 31, 14))
    const { db, close } = bootClinicDb({ clock })
    try {
      connectWa(db, clock)
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:idle:2',
          waId: '5511987001555',
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
      rescheduleConversationIdle(db, 'clinic-demo-a', conversationId, clock, {
        progressAt: clock.nowMs(),
      })

      // Mensagem system NÃO cancela o prazo.
      const beforeDue = db.get<{ due: number | null }>(
        `SELECT idle_due_at AS due FROM conversations WHERE id = ?`,
        conversationId,
      )!.due
      const sysAt = clock.nowMs() + 60_000
      clock.advance(60_000)
      insertMessage(
        db,
        {
          tenantId: 'clinic-demo-a',
          conversationId,
          direction: 'system',
          body: 'nota interna',
          externalMessageId: null,
          deliveryState: 'received',
          authorClerkUserId: 'system:panel',
          authorDisplayName: 'Sistema',
          createdAt: sysAt,
        },
        clock,
      )
      touchConversationMessage(db, {
        tenantId: 'clinic-demo-a',
        conversationId,
        preview: 'nota interna',
        direction: 'system',
        at: sysAt,
        bumpUnread: false,
        reopenIfClosed: false,
      })
      const afterSys = db.get<{ due: number | null }>(
        `SELECT idle_due_at AS due FROM conversations WHERE id = ?`,
        conversationId,
      )!.due
      expect(afterSys).toBe(beforeDue)

      clock.advance(IDLE_PROMPT_AFTER_MS)
      sweepDueIdleConversations(db, 'clinic-demo-a', clock)
      const phase = db.get<{ phase: string | null }>(
        `SELECT idle_phase AS phase FROM conversations WHERE id = ?`,
        conversationId,
      )?.phase
      expect(phase).toBe('close')

      clock.advance(IDLE_CLOSE_AFTER_MS + 1)
      const closed = sweepDueIdleConversations(db, 'clinic-demo-a', clock)
      expect(closed.some((s) => s.action === 'closed')).toBe(true)
      const opp = findOpenOpportunityForConversation(db, 'clinic-demo-a', conversationId)
      expect(opp).toBeNull()

      // Nova conversa com humano activo não agenda idle.
      const ingested2 = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:idle:3',
          waId: '5511987001444',
          body: 'oi',
        },
        clock,
      )
      const cnv2 = ingested2.conversation!.id
      ensureOpenOpportunity(
        db,
        {
          tenantId: 'clinic-demo-a',
          contactId: ingested2.contact!.id,
          conversationId: cnv2,
        },
        clock,
      )
      notifyHumanHandoff(
        db,
        'clinic-demo-a',
        {
          conversationId: cnv2,
          reason: 'customer_requested',
          clientRequestId: 'handoff-idle-test',
        },
        clock,
      )
      const due2 = rescheduleConversationIdle(db, 'clinic-demo-a', cnv2, clock)
      expect(due2).toBeNull()
      const idleCols = db.get<{ due: number | null; phase: string | null }>(
        `SELECT idle_due_at AS due, idle_phase AS phase FROM conversations WHERE id = ?`,
        cnv2,
      )
      expect(idleCols).toEqual({ due: null, phase: null })
    } finally {
      close()
    }
  })
})
