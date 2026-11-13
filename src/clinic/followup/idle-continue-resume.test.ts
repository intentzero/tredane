/**
 * DEC-087 — Prosseguir retoma contexto (staging cnv_3fa911760aa64516, 12/11/2026).
 */
import { describe, expect, it, vi } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { ensureOpenOpportunity } from '../pipeline/operations'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import * as autobookMod from '../ai/autobook'
import { encodeChoiceId } from '../ai/choice-offer'
import { saveBookingFrame } from '../ai/schedule-session'
import {
  handleIdleButtonClick,
  handleIdleTextReply,
  IDLE_CONTINUE_REPLY_BODY,
  IDLE_PROMPT_AFTER_MS,
  idleButtonId,
  rescheduleConversationIdle,
  sweepDueIdleConversations,
} from './idle'
import { IDLE_RESUME_LEAD_IN } from './idle-continue-resume'

const NOW = Date.UTC(2026, 10, 12, 12, 0)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-idle-resume'
  const caller = workerCaller(tenantId, 'user_owner')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_idle',
      phoneNumberId: 'pn_idle',
      wabaId: 'waba_idle',
      displayPhone: '+5511900000888',
      displayName: 'Clínica Idle',
      action: 'channel_connected',
    },
    clock,
  )
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Ana' }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 12000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000888', displayName: 'Cliente' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  ensureOpenOpportunity(db, { tenantId, contactId: contact.id, conversationId: cnv.id }, clock)
  const outboundBodies = () =>
    db
      .all<{ body: string }>(
        `SELECT body FROM messages
         WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at`,
        tenantId,
        cnv.id,
      )
      .map((r) => r.body)
  return { ...boot, clock, tenantId, caller, cnv, svc, contact, outboundBodies }
}

function armIdlePrompt(s: ReturnType<typeof seed>) {
  rescheduleConversationIdle(s.db, s.tenantId, s.cnv.id, s.clock, {
    progressAt: s.clock.nowMs(),
  })
  s.clock.advance(IDLE_PROMPT_AFTER_MS + 1)
  sweepDueIdleConversations(s.db, s.tenantId, s.clock)
}

describe('idle Prosseguir retoma contexto', () => {
  it('escolha de lista sem resposta + Prosseguir processa o horário (sem cópia genérica)', async () => {
    const s = seed()
    const spy = vi.spyOn(autobookMod, 'tryAiAutoBook').mockResolvedValue({
      status: 'not_confirmed',
      missing: ['horario'],
      confirmationMessageId: 'in_slot',
      outbox: [],
      replyText: 'Proposta montada',
    })
    try {
      const catalogVersion = 'cv_idle_1'
      const slotKey = '2026-11-16T10:00'
      const offerAt = s.clock.nowMs()
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          catalogVersion,
          pending: {
            slot: 'horario',
            messageId: 'msg_slots',
            options: [
              { key: '2026-11-16T09:00', label: 'segunda 16/11 09:00' },
              { key: '2026-11-16T09:30', label: 'segunda 16/11 09:30' },
              { key: slotKey, label: 'segunda 16/11 10:00' },
            ],
          },
          phase: 'ofertado',
        },
        s.clock,
      )
      s.db.run(
        `INSERT INTO messages (id, tenant_id, conversation_id, direction, body, delivery_state, created_at)
         VALUES ('msg_slots', ?, ?, 'outbound', ?, 'delivered', ?)`,
        s.tenantId,
        s.cnv.id,
        'Segunda 16/11: 09:00, 09:30 ou 10:00?',
        offerAt,
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '[Lista] segunda 16/11 10:00',
          deliveryState: 'received',
          createdAt: offerAt + 5_000,
        },
        s.clock,
      )
      s.clock.advance(30 * 60 * 1000)
      armIdlePrompt(s)

      const click = handleIdleButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: idleButtonId(s.cnv.id, 'continue'),
          providerEventKey: 'wa:idle:resume:choice',
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      if (!click.handled) return
      expect(click.resumeChoice?.buttonId).toBe(encodeChoiceId('horario', catalogVersion, slotKey))
      expect(s.outboundBodies()).not.toContain(IDLE_CONTINUE_REPLY_BODY)
      const { runIdleContinueChoiceResume } = await import('./idle-continue-resume')
      const resumed = await runIdleContinueChoiceResume(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          resume: click.resumeChoice!,
          providerEventKey: 'wa:idle:resume:choice',
        },
        s.clock,
      )
      expect(resumed.length).toBeGreaterThan(0)
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
      s.close()
    }
  })

  it('oferta pendente + Prosseguir reenvia os mesmos horários', () => {
    const s = seed()
    try {
      const catalogVersion = 'cv_idle_2'
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          catalogVersion,
          pending: {
            slot: 'horario',
            messageId: 'msg_slots_2',
            options: [
              { key: '2026-11-16T09:00', label: 'segunda 16/11 09:00' },
              { key: '2026-11-16T10:00', label: 'segunda 16/11 10:00' },
            ],
          },
          phase: 'ofertado',
        },
        s.clock,
      )
      const offerAt = s.clock.nowMs()
      s.db.run(
        `INSERT INTO messages (id, tenant_id, conversation_id, direction, body, delivery_state, created_at)
         VALUES ('msg_slots_2', ?, ?, 'outbound', ?, 'delivered', ?)`,
        s.tenantId,
        s.cnv.id,
        'Segunda 16/11: 09:00 ou 10:00?',
        offerAt,
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'ok',
          deliveryState: 'received',
          createdAt: offerAt + 2_000,
        },
        s.clock,
      )
      s.clock.advance(30 * 60 * 1000)
      armIdlePrompt(s)

      const click = handleIdleButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: idleButtonId(s.cnv.id, 'continue'),
          providerEventKey: 'wa:idle:resume:reoffer',
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      if (!click.handled) return
      expect(click.resumeChoice).toBeUndefined()
      expect(s.outboundBodies().some((b) => b.includes(IDLE_RESUME_LEAD_IN))).toBe(true)
      expect(s.outboundBodies()).not.toContain(IDLE_CONTINUE_REPLY_BODY)
    } finally {
      s.close()
    }
  })

  it('sem contexto mantém resposta genérica', () => {
    const s = seed()
    try {
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'oi',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      armIdlePrompt(s)
      const click = handleIdleButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: idleButtonId(s.cnv.id, 'continue'),
          providerEventKey: 'wa:idle:resume:generic',
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      expect(s.outboundBodies()).toContain(IDLE_CONTINUE_REPLY_BODY)
    } finally {
      s.close()
    }
  })

  it('texto livre Prosseguir comporta-se como o botão', async () => {
    const s = seed()
    const spy = vi.spyOn(autobookMod, 'tryAiAutoBook').mockResolvedValue({
      status: 'not_confirmed',
      missing: [],
      confirmationMessageId: null,
      outbox: [],
      replyText: 'ok',
    })
    try {
      const catalogVersion = 'cv_idle_4'
      const slotKey = '2026-11-16T10:00'
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          catalogVersion,
          pending: {
            slot: 'horario',
            messageId: 'msg_slots_4',
            options: [{ key: slotKey, label: 'segunda 16/11 10:00' }],
          },
          phase: 'ofertado',
        },
        s.clock,
      )
      const offerAt = s.clock.nowMs()
      s.db.run(
        `INSERT INTO messages (id, tenant_id, conversation_id, direction, body, delivery_state, created_at)
         VALUES ('msg_slots_4', ?, ?, 'outbound', ?, 'delivered', ?)`,
        s.tenantId,
        s.cnv.id,
        'Horários segunda',
        offerAt,
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '[Lista] segunda 16/11 10:00',
          deliveryState: 'received',
          createdAt: offerAt + 1_000,
        },
        s.clock,
      )
      s.clock.advance(30 * 60 * 1000)
      armIdlePrompt(s)
      const text = handleIdleTextReply(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          text: 'Prosseguir',
          providerEventKey: 'wa:idle:resume:text',
        },
        s.clock,
      )
      expect(text.handled).toBe(true)
      if (!text.handled) return
      expect(text.resumeChoice?.buttonId).toBe(encodeChoiceId('horario', catalogVersion, slotKey))
      expect(s.outboundBodies()).not.toContain(IDLE_CONTINUE_REPLY_BODY)
    } finally {
      spy.mockRestore()
      s.close()
    }
  })

  it('dois toques Prosseguir com a mesma chave → uma resposta', () => {
    const s = seed()
    try {
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'oi',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      armIdlePrompt(s)
      const input = {
        tenantId: s.tenantId,
        conversationId: s.cnv.id,
        buttonId: idleButtonId(s.cnv.id, 'continue'),
        providerEventKey: 'wa:idle:resume:idem',
      }
      const first = handleIdleButtonClick(s.db, input, s.clock)
      const second = handleIdleButtonClick(s.db, input, s.clock)
      expect(first.handled && second.handled).toBe(true)
      if (!first.handled || !second.handled) return
      const genericCount = s.outboundBodies().filter((b) => b === IDLE_CONTINUE_REPLY_BODY).length
      expect(genericCount).toBe(1)
      expect(second.outbox.length).toBe(0)
    } finally {
      s.close()
    }
  })
})
