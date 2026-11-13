/**
 * ADR-0015 / #412 — same-TX: BookingFrame + mensagem outbound + outbox.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation, touchConversationMessage } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { sendOutboundMessageOp } from '../inbox/operations'
import { bootClinicDb } from '../test-db'
import { bindOrAssertTenant } from '../tenant'
import { syncWhatsappChannel } from '../whatsapp/channel'
import {
  createDeferredBookingFrame,
  offerFramePatch,
  OUTBOUND_MESSAGE_ID_PLACEHOLDER,
} from './deferred-booking-frame'
import { clearBookingFrame, getBookingFrame, saveBookingFrame } from './schedule-session'

function boot() {
  const clock = createControllableClock(Date.UTC(2026, 10, 5, 15, 0))
  const { db, close } = bootClinicDb({ clock })
  const tenantId = 'clinic-demo-same-tx'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  bindOrAssertTenant(db, caller, clock)
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_same_tx',
      phoneNumberId: 'pn_same_tx',
      wabaId: 'waba_same_tx',
      displayPhone: '+5511900000011',
      displayName: 'Clínica SameTX',
      action: 'channel_connected',
    },
    clock,
  )
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511900000011', displayName: 'Ana SameTX' },
    clock,
  )
  const conversation = createConversation(
    db,
    { tenantId, contactId: contact.id, status: 'open' },
    clock,
  )
  // inbound abre janela 24 h
  const inbound = insertMessage(
    db,
    {
      tenantId,
      conversationId: conversation.id,
      direction: 'inbound',
      body: 'oi',
      deliveryState: 'received',
      createdAt: clock.nowMs(),
    },
    clock,
  )
  touchConversationMessage(db, {
    tenantId,
    conversationId: conversation.id,
    preview: inbound.body,
    direction: 'inbound',
    at: inbound.createdAt,
    bumpUnread: true,
    reopenIfClosed: true,
  })
  return { db, clock, tenantId, conversationId: conversation.id, close, caller }
}

describe('BookingFrame same-TX (ADR-0015)', () => {
  it('grava frame + mensagem + outboxes no mesmo commit; messageId = outbound', () => {
    const { db, clock, tenantId, conversationId, close, caller } = boot()
    try {
      const deferred = createDeferredBookingFrame()
      const patch = offerFramePatch({
        serviceId: 'svc-dep',
        phase: 'ofertado',
        slots: [
          { startsAt: clock.nowMs() + 3600_000, professionalId: 'pro-1', time: '14:00', date: '2026-11-06' },
          { startsAt: clock.nowMs() + 7200_000, professionalId: 'pro-1', time: '15:00', date: '2026-11-06' },
        ],
      })
      // Same-day offer → pending labels are HH:MM only (Paulo 13/11/2026).
      expect(patch.pending?.options.map((o) => o.label)).toEqual(['14:00', '15:00'])
      deferred.save(patch)
      expect(getBookingFrame(db, tenantId, conversationId)).toBeNull()

      const sent = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId,
          body: 'Tenho 14:00 e 15:00. Qual fica melhor?',
          clientRequestId: 'same-tx-offer-1',
          authorClerkUserId: 'system:ai-autodraft',
          authorDisplayName: 'IA',
          afterPersist: deferred.toAfterPersist(clock),
        },
        clock,
      )

      const frame = getBookingFrame(db, tenantId, conversationId)
      expect(frame?.phase).toBe('ofertado')
      expect(frame?.pending?.messageId).toBe(sent.value.message.id)
      expect(frame?.lastOffer?.messageId).toBe(sent.value.message.id)
      expect(frame?.pending?.messageId).not.toBe(OUTBOUND_MESSAGE_ID_PLACEHOLDER)

      const types = sent.outbox.map((o) => o.type)
      expect(types).toContain('message.created')
      expect(types).toContain('whatsapp.send')
      expect(types).toContain('booking_frame.updated')
    } finally {
      close()
    }
  })

  it('rollback: se afterPersist falha, nem frame nem mensagem ficam', () => {
    const { db, clock, tenantId, conversationId, close, caller } = boot()
    try {
      const beforeMsgs = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'`,
        tenantId,
        conversationId,
      )?.n

      expect(() =>
        sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId,
            body: 'oferta que vai falhar',
            clientRequestId: 'same-tx-rollback-1',
            authorClerkUserId: 'system:ai-autodraft',
            authorDisplayName: 'IA',
            afterPersist: (ctx) => {
              saveBookingFrame(
                ctx.db,
                ctx.tenantId,
                ctx.conversationId,
                {
                  serviceId: 'svc-dep',
                  phase: 'ofertado',
                  pending: {
                    slot: 'horario',
                    options: [{ key: '14:00', label: '14:00' }],
                    messageId: ctx.messageId,
                  },
                  lastOffer: {
                    slots: [{ startsAt: 1, professionalId: 'p' }],
                    messageId: ctx.messageId,
                  },
                },
                clock,
              )
              throw new Error('forced_after_persist_failure')
            },
          },
          clock,
        ),
      ).toThrow(/forced_after_persist_failure/)

      expect(getBookingFrame(db, tenantId, conversationId)).toBeNull()
      const afterMsgs = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'`,
        tenantId,
        conversationId,
      )?.n
      expect(afterMsgs).toBe(beforeMsgs)
      const outboxN = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM outbox_events WHERE tenant_id = ? AND type IN ('whatsapp.send', 'booking_frame.updated')`,
        tenantId,
      )?.n
      expect(outboxN).toBe(0)
    } finally {
      close()
    }
  })

  it('clear-on-another: clear + ask na mesma TX; rollback restaura frame', () => {
    const { db, clock, tenantId, conversationId, close, caller } = boot()
    try {
      saveBookingFrame(
        db,
        tenantId,
        conversationId,
        { serviceId: 'svc-keep', phase: 'proposto', time: '14:00', date: '2026-11-06' },
        clock,
      )
      expect(getBookingFrame(db, tenantId, conversationId)?.serviceId).toBe('svc-keep')

      expect(() =>
        sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId,
            body: 'Qual serviço você quer agora?',
            clientRequestId: 'same-tx-clear-fail',
            authorClerkUserId: 'system:conversational-followup',
            authorDisplayName: 'Sistema',
            afterPersist: ({ db: txDb, tenantId: tid, conversationId: cid }) => {
              clearBookingFrame(txDb, tid, cid, clock)
              throw new Error('forced_clear_rollback')
            },
          },
          clock,
        ),
      ).toThrow(/forced_clear_rollback/)

      expect(getBookingFrame(db, tenantId, conversationId)?.serviceId).toBe('svc-keep')
    } finally {
      close()
    }
  })

  it('overlay: peekSession vê patch antes do commit', () => {
    const { db, clock, tenantId, conversationId, close } = boot()
    try {
      const deferred = createDeferredBookingFrame()
      deferred.save({ serviceId: 'svc-overlay', audienceLine: 'feminino' })
      expect(getBookingFrame(db, tenantId, conversationId)).toBeNull()
      expect(deferred.peekSession(db, tenantId, conversationId)?.serviceId).toBe('svc-overlay')
      expect(deferred.peekSession(db, tenantId, conversationId)?.audienceLine).toBe('feminino')
      deferred.flushNow(db, tenantId, conversationId, clock)
      expect(getBookingFrame(db, tenantId, conversationId)?.serviceId).toBe('svc-overlay')
    } finally {
      close()
    }
  })
})
