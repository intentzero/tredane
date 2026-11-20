/**
 * DEC-087 / DEC-208 — idle 30 min sem actividade → fecho gracioso.
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
import { getBookingFrame, saveBookingFrame } from '../ai/schedule-session'
import { CLIENT_WEB_CTA_TEXT } from '../../clientweb/offer'
import { sendOutboundMessageOp } from '../inbox/operations'
import {
  handleIdleButtonClick,
  handleIdleTextReply,
  IDLE_AUTO_CLOSE_BODY,
  IDLE_TIMEOUT_MS,
  idleButtonId,
  parseIdleButtonId,
  parseIdleTextReply,
  rescheduleConversationIdle,
  sweepDueIdleConversations,
} from './idle'
import { suppressFollowupsAfterClientEnd } from './suppress-after-end'
import { isTerminarFarewellBody } from './terminar-farewell'

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

describe('DEC-208 idle timeout 30 min', () => {
  it('migração 46 e parse de botões legados', () => {
    expect(CLINIC_SCHEMA_VERSION).toBe(80)
    expect(parseIdleButtonId(idleButtonId('cnv_1', 'continue'))).toEqual({
      conversationId: 'cnv_1',
      action: 'continue',
    })
    expect(parseIdleButtonId('fu:post:x:thanks')).toBeNull()
    expect(parseIdleTextReply('Terminar')).toBe('end')
    expect(parseIdleTextReply('prosseguir')).toBe('continue')
    expect(parseIdleTextReply('[Botão] Terminar')).toBeNull()
    expect(parseIdleTextReply('quero terminar depois')).toBeNull()
  })

  it('após 30 min fecha sem pergunta; Terminar legado sem horário futuro vai a Perdido', () => {
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
      expect(due).toBe(clock.nowMs() + IDLE_TIMEOUT_MS)

      // Botão Terminar legado (mensagem antiga) ainda fecha.
      clock.advance(1_000)
      db.run(
        `UPDATE conversations SET idle_phase = 'close', idle_prompt_sent_at = ? WHERE id = ?`,
        clock.nowMs(),
        conversationId,
      )
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
      expect(opp).toEqual({ stage: 'perdido', status: 'closed' })
      const thanks = db.get<{ body: string }>(
        `SELECT body FROM messages
         WHERE conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC LIMIT 1`,
        conversationId,
      )
      expect(isTerminarFarewellBody(thanks?.body ?? '', 'America/Sao_Paulo', clock.nowMs())).toBe(
        true,
      )
    } finally {
      close()
    }
  })

  it('fecho automático com horário futuro agradece e permanece Agendado', () => {
    const clock = createControllableClock(Date.UTC(2026, 10, 14, 13, 43))
    const { db, close } = bootClinicDb({ clock })
    try {
      connectWa(db, clock)
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:idle:future-close',
          waId: '5511987001777',
          body: 'oi',
        },
        clock,
      )
      const conversationId = ingested.conversation!.id
      const contactId = ingested.contact!.id
      ensureOpenOpportunity(
        db,
        { tenantId: 'clinic-demo-a', contactId, conversationId },
        clock,
      )
      const opp = findOpenOpportunityForConversation(db, 'clinic-demo-a', conversationId)!
      db.run(
        `UPDATE opportunities SET stage = 'agendado', updated_at = ? WHERE tenant_id = ? AND id = ?`,
        clock.nowMs(),
        'clinic-demo-a',
        opp.id,
      )
      const startsAt = clock.nowMs() + 7 * 24 * 60 * 60_000
      db.run(
        `INSERT INTO appointments (
           id, tenant_id, service_id, professional_id, starts_at, ends_at, status,
           created_at, contact_id, conversation_id, confirmed_by
         ) VALUES (?, ?, 'svc_fake', 'pro_fake', ?, ?, 'confirmed', ?, ?, ?, ?)`,
        'apt_idle_future',
        'clinic-demo-a',
        startsAt,
        startsAt + 40 * 60_000,
        clock.nowMs(),
        contactId,
        conversationId,
        'user_synth_attendant_a',
      )

      rescheduleConversationIdle(db, 'clinic-demo-a', conversationId, clock, {
        progressAt: clock.nowMs(),
      })
      clock.advance(IDLE_TIMEOUT_MS + 1)
      const closed = sweepDueIdleConversations(db, 'clinic-demo-a', clock)
      expect(closed.some((s) => s.action === 'closed')).toBe(true)
      const still = findOpenOpportunityForConversation(db, 'clinic-demo-a', conversationId)
      expect(still?.stage).toBe('agendado')
      expect(still?.status).toBe('open')
      const thanks = db.get<{ body: string }>(
        `SELECT body FROM messages
         WHERE conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC LIMIT 1`,
        conversationId,
      )
      expect(thanks?.body).toBe(IDLE_AUTO_CLOSE_BODY)
      const suppressed = db.get<{ at: number | null }>(
        `SELECT idle_suppressed_at AS at FROM conversations WHERE id = ?`,
        conversationId,
      )?.at
      expect(suppressed).not.toBeNull()
    } finally {
      close()
    }
  })

  it('30 min sem resposta fecha; system não reinicia; humano também encerra', () => {
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

      clock.advance(IDLE_TIMEOUT_MS)
      const closed = sweepDueIdleConversations(db, 'clinic-demo-a', clock)
      expect(closed.some((s) => s.action === 'closed')).toBe(true)
      const opp = findOpenOpportunityForConversation(db, 'clinic-demo-a', conversationId)
      expect(opp).toBeNull()

      // Humano activo: ainda agenda e encerra após 30 min (DEC-208).
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
      expect(due2).toBe(clock.nowMs() + IDLE_TIMEOUT_MS)
      const idleCols = db.get<{ due: number | null; phase: string | null }>(
        `SELECT idle_due_at AS due, idle_phase AS phase FROM conversations WHERE id = ?`,
        cnv2,
      )
      expect(idleCols?.phase).toBe('close')
      expect(idleCols?.due).toBe(clock.nowMs() + IDLE_TIMEOUT_MS)

      clock.advance(IDLE_TIMEOUT_MS + 1)
      const closedHuman = sweepDueIdleConversations(db, 'clinic-demo-a', clock)
      expect(closedHuman.some((s) => s.action === 'closed' && s.conversationId === cnv2)).toBe(
        true,
      )
      const thanksHuman = db.get<{ body: string }>(
        `SELECT body FROM messages
         WHERE conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC LIMIT 1`,
        cnv2,
      )
      expect(thanksHuman?.body).toBe(IDLE_AUTO_CLOSE_BODY)
    } finally {
      close()
    }
  })

  it('texto livre Terminar após prompt legado limpa BookingFrame', () => {
    const clock = createControllableClock(Date.UTC(2026, 10, 8, 13, 0))
    const { db, close } = bootClinicDb({ clock })
    try {
      connectWa(db, clock)
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:idle:text-end',
          waId: '5511987001444',
          body: 'quero liberacao',
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
      saveBookingFrame(
        db,
        'clinic-demo-a',
        conversationId,
        { serviceId: 'svc_liberacao', date: '2026-11-11' },
        clock,
      )
      // Simula conversa à espera de resposta a um prompt legado.
      db.run(
        `UPDATE conversations
         SET idle_phase = 'close', idle_prompt_sent_at = ?, idle_due_at = ?
         WHERE id = ?`,
        clock.nowMs(),
        clock.nowMs() + IDLE_TIMEOUT_MS,
        conversationId,
      )

      clock.advance(1_000)
      const text = handleIdleTextReply(
        db,
        {
          tenantId: 'clinic-demo-a',
          conversationId,
          text: 'Terminar',
          providerEventKey: 'wa:idle:text-end:terminar',
        },
        clock,
      )
      expect(text.handled).toBe(true)
      if (!text.handled) return
      expect(text.action).toBe('end')
      expect(getBookingFrame(db, 'clinic-demo-a', conversationId)).toBeNull()
      const thanksText = db.get<{ body: string }>(
        `SELECT body FROM messages
         WHERE conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC LIMIT 1`,
        conversationId,
      )
      expect(
        isTerminarFarewellBody(thanksText?.body ?? '', 'America/Sao_Paulo', clock.nowMs()),
      ).toBe(true)
      expect(
        handleIdleTextReply(
          db,
          {
            tenantId: 'clinic-demo-a',
            conversationId,
            text: '[Botão] Terminar',
          },
          clock,
        ).handled,
      ).toBe(false)
    } finally {
      close()
    }
  })

  it('fecho automático limpa BookingFrame e envia frase fixa', () => {
    const clock = createControllableClock(Date.UTC(2026, 10, 8, 14, 55))
    const { db, close } = bootClinicDb({ clock })
    try {
      connectWa(db, clock)
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:idle:align',
          waId: '5511987001333',
          body: 'quero liberacao',
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
      saveBookingFrame(
        db,
        'clinic-demo-a',
        conversationId,
        { serviceId: 'svc_orphan', date: '2026-11-11' },
        clock,
      )
      rescheduleConversationIdle(db, 'clinic-demo-a', conversationId, clock, {
        progressAt: clock.nowMs(),
      })

      clock.advance(IDLE_TIMEOUT_MS + 1)
      const closed = sweepDueIdleConversations(db, 'clinic-demo-a', clock)
      expect(closed.some((s) => s.action === 'closed')).toBe(true)
      expect(getBookingFrame(db, 'clinic-demo-a', conversationId)).toBeNull()
      const thanksClose = db.get<{ body: string }>(
        `SELECT body FROM messages
         WHERE conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC LIMIT 1`,
        conversationId,
      )
      expect(thanksClose?.body).toBe(IDLE_AUTO_CLOSE_BODY)
    } finally {
      close()
    }
  })

  it('após farewell/suppress, «Abrir agenda» limpa suppress e rearma idle 30 min (DEC-202/208)', () => {
    // Staging Paulo: tchau → adeus → «Quero agendar» + Abrir agenda → ~25 min sem fecho.
    const clock = createControllableClock(Date.UTC(2026, 10, 19, 20, 6))
    const { db, close } = bootClinicDb({ clock })
    try {
      connectWa(db, clock)
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:idle:abrir-rearm',
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
      suppressFollowupsAfterClientEnd(db, 'clinic-demo-a', conversationId, clock)
      expect(
        db.get<{ at: number | null }>(
          `SELECT idle_suppressed_at AS at FROM conversations WHERE id = ?`,
          conversationId,
        )?.at,
      ).not.toBeNull()

      clock.advance(60_000)
      ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:idle:abrir-rearm:ask',
          waId: '5511987001999',
          body: 'Oi tudo bem? Quero agendar uma depilação para amanha',
        },
        clock,
      )
      expect(
        db.get<{ due: number | null }>(
          `SELECT idle_due_at AS due FROM conversations WHERE id = ?`,
          conversationId,
        )?.due,
      ).toBeNull()

      sendOutboundMessageOp(
        db,
        workerCaller('clinic-demo-a', 'system:ai-autodraft'),
        {
          conversationId,
          body: 'Para agendar depilação, toque em «Abrir agenda» e escolha o dia e a hora. Se tiver dúvidas, escreva aqui.',
          interactive: {
            ctaUrl: {
              displayText: CLIENT_WEB_CTA_TEXT,
              url: 'https://staging.app.tredane.com/c/cw1_testtokenabcdefghijklmnop',
            },
          },
          clientRequestId: 'wa:idle:abrir-rearm:cta',
          authorClerkUserId: 'system:ai-autodraft',
          authorDisplayName: 'Assistente',
        },
        clock,
      )
      const afterCta = db.get<{ due: number | null; suppressed: number | null }>(
        `SELECT idle_due_at AS due, idle_suppressed_at AS suppressed
         FROM conversations WHERE id = ?`,
        conversationId,
      )
      expect(afterCta?.suppressed).toBeNull()
      expect(afterCta?.due).toBe(clock.nowMs() + IDLE_TIMEOUT_MS)

      clock.advance(IDLE_TIMEOUT_MS + 1)
      const closed = sweepDueIdleConversations(db, 'clinic-demo-a', clock)
      expect(closed.some((s) => s.action === 'closed')).toBe(true)
      const farewell = db.get<{ body: string }>(
        `SELECT body FROM messages
         WHERE conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC LIMIT 1`,
        conversationId,
      )
      expect(farewell?.body).toBe(IDLE_AUTO_CLOSE_BODY)
    } finally {
      close()
    }
  })
})
