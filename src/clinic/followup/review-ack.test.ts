/**
 * TRE-29 — Continuar | Terminar no ack de avaliar/feedback.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { SimulatedAiAdapter } from '../../ai'
import { enqueueAutoDraft, runDueAutoDrafts } from '../ai'
import {
  getBookingFrame,
  saveBookingFrame,
} from '../ai/schedule-session'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import {
  reviewFlagAckButtonId,
  REVIEW_FLAG_CLIENT_ACK,
} from '../inbox/review-flag'
import { IDLE_CONTINUE_REPLY_BODY } from './idle'
import { handleReviewFlagAckButtonClick } from './review-ack'
import { isTerminarFarewellBody } from './terminar-farewell'

const NOW = Date.UTC(2026, 10, 13, 18, 0)
const TZ = 'America/Sao_Paulo'

function seedFlaggedConversation(opts?: { withPending?: boolean }) {
  const clock = createControllableClock(NOW)
  const { db, close } = bootClinicDb({ clock })
  const tenantId = 'clinic-demo-a'
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_review_ack',
      phoneNumberId: 'pn_review_ack',
      wabaId: 'waba_review_ack',
      displayPhone: '+5511900000088',
      displayName: 'Clínica Review Ack',
      action: 'channel_connected',
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511900000088', displayName: 'Bia Fictícia' },
    clock,
  )
  const cnv = createConversation(
    db,
    { tenantId, contactId: contact.id, status: 'open' },
    clock,
  )
  insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: 'quero marcar',
      deliveryState: 'received',
      createdAt: NOW - 10_000,
    },
    clock,
  )
  if (opts?.withPending) {
    saveBookingFrame(
      db,
      tenantId,
      cnv.id,
      {
        serviceId: 'svc_massagem',
        variantIds: ['z_relax'],
        phase: 'ofertado',
        pending: {
          slot: 'horario',
          options: [
            { key: '2026-11-14T09:00', label: '09:00' },
            { key: '2026-11-14T09:30', label: '09:30' },
          ],
          messageId: 'm_review_slots',
        },
        lastOffer: {
          slots: [
            { startsAt: Date.UTC(2026, 10, 14, 12, 0), professionalId: 'pro_x' },
            { startsAt: Date.UTC(2026, 10, 14, 12, 30), professionalId: 'pro_x' },
          ],
          messageId: 'm_review_slots',
        },
      },
      clock,
    )
  }
  const inbound = insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: 'Avaliar',
      deliveryState: 'received',
      createdAt: NOW,
    },
    clock,
  )
  enqueueAutoDraft(
    db,
    tenantId,
    { conversationId: cnv.id, messageId: inbound.id },
    clock,
  )
  clock.advance(7_000)
  return { db, close, clock, tenantId, cnv }
}

describe('TRE-29 review ack Continuar | Terminar', () => {
  it('ack leva botões; Terminar limpa o frame e agradece', async () => {
    const { db, close, clock, tenantId, cnv } = seedFlaggedConversation({
      withPending: true,
    })
    try {
      const caller = workerCaller(tenantId, 'user_synth_owner_a')
      await runDueAutoDrafts(db, caller, clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(getBookingFrame(db, tenantId, cnv.id)?.pending?.slot).toBe('horario')
      const ack = db.get<{ body: string }>(
        `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        cnv.id,
      )
      expect(ack?.body).toBe(REVIEW_FLAG_CLIENT_ACK)

      clock.advance(1_000)
      const click = handleReviewFlagAckButtonClick(
        db,
        {
          tenantId,
          conversationId: cnv.id,
          buttonId: reviewFlagAckButtonId(cnv.id, 'end'),
          providerEventKey: 'wa:review:end',
        },
        clock,
      )
      expect(click.handled).toBe(true)
      if (!click.handled) return
      expect(click.action).toBe('end')
      expect(getBookingFrame(db, tenantId, cnv.id)).toBeNull()
      const thanks = db.get<{ body: string }>(
        `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        cnv.id,
      )
      expect(isTerminarFarewellBody(thanks?.body ?? '', TZ, clock.nowMs())).toBe(true)
    } finally {
      close()
    }
  })

  it('Continuar sem oferta reenvia a cópia genérica de retoma', async () => {
    const { db, close, clock, tenantId, cnv } = seedFlaggedConversation()
    try {
      const caller = workerCaller(tenantId, 'user_synth_owner_a')
      await runDueAutoDrafts(db, caller, clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      clock.advance(1_000)
      const click = handleReviewFlagAckButtonClick(
        db,
        {
          tenantId,
          conversationId: cnv.id,
          buttonId: reviewFlagAckButtonId(cnv.id, 'continue'),
          providerEventKey: 'wa:review:continue',
        },
        clock,
      )
      expect(click.handled).toBe(true)
      if (!click.handled) return
      expect(click.action).toBe('continue')
      const reply = db.get<{ body: string }>(
        `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        cnv.id,
      )
      expect(reply?.body).toBe(IDLE_CONTINUE_REPLY_BODY)
    } finally {
      close()
    }
  })

  it('id de outra conversa ou idle não é tratado', () => {
    const { db, close, clock, tenantId, cnv } = seedFlaggedConversation()
    try {
      expect(
        handleReviewFlagAckButtonClick(
          db,
          {
            tenantId,
            conversationId: cnv.id,
            buttonId: reviewFlagAckButtonId('other', 'end'),
            providerEventKey: 'x',
          },
          clock,
        ).handled,
      ).toBe(false)
      expect(
        handleReviewFlagAckButtonClick(
          db,
          {
            tenantId,
            conversationId: cnv.id,
            buttonId: `fu:idle:${cnv.id}:end`,
            providerEventKey: 'x',
          },
          clock,
        ).handled,
      ).toBe(false)
    } finally {
      close()
    }
  })
})
