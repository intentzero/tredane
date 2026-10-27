/**
 * Tiques: status da Meta que chega antes do id do provedor não pode ficar órfão;
 * abrir a conversa marca «Lida por» e gera recibo de leitura (whatsapp.mark_read).
 */
import { describe, expect, it } from 'vitest'
import { bootClinicDb } from '../clinic/test-db'
import { clinicInbox, ingestContactMessage, queueCaller, workerCaller } from '../clinic'
import { syncWhatsappChannel } from '../clinic/whatsapp/channel'
import {
  applyOutboundSendResultOp,
  markConversationReadOp,
  reconcileOutboundStatusOp,
  sendOutboundMessageOp,
} from '../clinic/inbox/operations'
import { processClinicOutboxMessage } from './outbound-send'

const T_A = 'clinic-demo-a'
const ATT = 'user_synth_attendant_a'

function setup() {
  const boot = bootClinicDb()
  syncWhatsappChannel(
    boot.db,
    T_A,
    {
      status: 'connected',
      bindingId: 'bind_ticks',
      phoneNumberId: 'pn_ticks_1',
      wabaId: 'waba_ticks',
      displayPhone: '+15551230000',
      action: 'channel_connected',
    },
    boot.clock,
  )
  return boot
}

describe('tiques e recibos de leitura', () => {
  it('status «delivered/read» que chegou antes do resultado do envio é reaplicado', () => {
    const { db, clock, close } = setup()
    try {
      const caller = workerCaller(T_A, ATT)
      const ing = ingestContactMessage(
        db,
        caller,
        { providerEventKey: 'wa:tk:1', waId: '5511999000101', body: 'oi' },
        clock,
      )
      const sent = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: ing.conversation!.id,
          body: 'olá!',
          clientRequestId: 'tk-1',
          authorClerkUserId: ATT,
          authorDisplayName: 'Ana',
        },
        clock,
      )
      const ob = sent.outbox.find((o) => o.type === 'whatsapp.send')!
      // Webhook de status chega primeiro (corrida com a resposta HTTP da Meta).
      reconcileOutboundStatusOp(
        db,
        queueCaller(T_A),
        { providerEventKey: 'st:tk:del', statusMessageId: 'wamid.tk_1', status: 'delivered' },
        clock,
      )
      reconcileOutboundStatusOp(
        db,
        queueCaller(T_A),
        { providerEventKey: 'st:tk:read', statusMessageId: 'wamid.tk_1', status: 'read' },
        clock,
      )
      const res = applyOutboundSendResultOp(
        db,
        queueCaller(T_A),
        {
          outboundId: sent.value.outbound.id,
          outboxEventId: ob.id,
          idempotencyKey: ob.idempotencyKey,
          outcome: 'succeeded',
          providerMessageId: 'wamid.tk_1',
        },
        clock,
      )
      expect(clinicInbox.findOutboundByClientRequestId(db, T_A, 'tk-1')!.deliveryState).toBe(
        'read',
      )
      expect(res.outbox.some((o) => o.type === 'message.delivery_updated')).toBe(true)
    } finally {
      close()
    }
  })

  it('abrir a conversa grava «Lida por» e emite whatsapp.mark_read (uma vez)', async () => {
    const { db, clock, close } = setup()
    try {
      const caller = workerCaller(T_A, ATT)
      const ing = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:msg:wamid.in_2',
          waId: '5511999000102',
          body: 'tem horário?',
        },
        clock,
      )
      const r = markConversationReadOp(
        db,
        caller,
        {
          conversationId: ing.conversation!.id,
          readerClerkUserId: ATT,
          readerDisplayName: 'Ana',
        },
        clock,
      )
      const mark = r.outbox.find((o) => o.type === 'whatsapp.mark_read')
      expect(JSON.parse(mark!.payloadJson)).toMatchObject({ providerMessageId: "wamid.in_2" })
      const row = db.get<{ read_by_display_name: string; read_at: number }>(
        `SELECT read_by_display_name, read_at FROM messages WHERE external_message_id = ?`,
        'wa:msg:wamid.in_2',
      )!
      expect(row.read_by_display_name).toBe('Ana')
      expect(row.read_at).toBeGreaterThan(0)
      const again = markConversationReadOp(
        db,
        caller,
        { conversationId: ing.conversation!.id, readerClerkUserId: ATT, readerDisplayName: 'Ana' },
        clock,
      )
      expect(again.outbox.some((o) => o.type === 'whatsapp.mark_read')).toBe(false)

      // Clínica demo: o consumer nunca chama a Meta.
      let called = false
      const out = await processClinicOutboxMessage(
        {
          tenantId: T_A,
          eventId: mark!.id,
          idempotencyKey: mark!.idempotencyKey,
          type: 'whatsapp.mark_read',
          payload: { providerMessageId: 'wamid.in_2' },
        } as never,
        {
          env: {} as never,
          metaAdapter: {
            markMessageRead: async () => {
              called = true
              return { ok: true }
            },
          } as never,
        },
      )
      expect(out).toBe('ack')
      expect(called).toBe(false)
    } finally {
      close()
    }
  })
})
