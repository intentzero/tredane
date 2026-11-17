/**
 * P21 — preço «antes de marcar» e frustração sem empurrar horário (Bella Pele demo).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { tryAiAutoBook } from './autobook'
import { clientDefersBookingChoice } from './booking-intent-text'
import { loadTurnContext } from './turn-context'
import { saveBookingFrame } from './schedule-session'

const TZ = 'America/Sao_Paulo'

describe('P21 — preço antes de marcar', () => {
  it('clientDefersBookingChoice detecta «antes de marcar»', () => {
    expect(clientDefersBookingChoice('mas qual o valor da drenagem? antes de marcar')).toBe(true)
    expect(clientDefersBookingChoice('qnto custa?')).toBe(false)
  })

  it('2.ª pergunta de preço e frustração sem «qual horário»', async () => {
    const NOW = Date.UTC(2026, 10, 16, 21, 0)
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-p21-defer'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_p21d',
        phoneNumberId: 'p_p21d',
        wabaId: 'w_p21d',
        displayPhone: '+5511900001260',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 2', category: 'Sala' }, clock)
    const pro = upsertResourceOp(
      db,
      caller,
      { kind: 'professional', name: 'Profissional', homeRoomId: room.id },
      clock,
    )
    const drenagem = upsertServiceOp(
      db,
      caller,
      {
        name: 'Drenagem linfática',
        durationMinutes: 45,
        bufferMinutes: 15,
        priceCents: 16_000,
        variantKind: null,
        variantKindPlural: null,
        variantSelection: 'uma',
        professionalIds: [pro.id],
        roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
      },
      clock,
    )
    const week = [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1140 }))
    setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
    setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(db, { tenantId, waId: '5511900001260', displayName: 'Cliente' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    saveBookingFrame(
      db,
      tenantId,
      cnv.id,
      {
        serviceId: drenagem.id,
        date: '2026-11-17',
        phase: 'ofertado',
        lastOffer: {
          slots: [{ startsAt: zonedCivilToUtc(TZ, 2026, 11, 17, 9, 0), professionalId: pro.id }],
          messageId: 'offer-p21-defer',
        },
        pending: {
          slot: 'horario',
          options: [{ key: '2026-11-17T09:00', label: '09:00' }],
          messageId: 'offer-p21-defer',
        },
      },
      clock,
    )
    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'outbound',
        body: 'Os horários disponíveis para amanhã são 09:00, 09:30, 10:00. Algum serve?',
        deliveryState: 'delivered',
        createdAt: clock.nowMs() - 2000,
      },
      clock,
    )

    const runTurn = async (body: string) => {
      const inbound = insertMessage(
        db,
        {
          tenantId,
          conversationId: cnv.id,
          direction: 'inbound',
          body,
          deliveryState: 'received',
          createdAt: clock.nowMs(),
        },
        clock,
      )
      clock.set(clock.nowMs() + 500)
      const turn = loadTurnContext(
        db,
        tenantId,
        {
          conversationId: cnv.id,
          contactId: contact.id,
          messageId: inbound.id,
          inboundBody: inbound.body,
        },
        clock,
      )
      const out = await tryAiAutoBook(db, caller, clock, {
        conversationId: cnv.id,
        enabled: true,
        capability: true,
        turn,
        confirmationMessageIdOverride: inbound.id,
      })
      if (out.replyText) {
        insertMessage(
          db,
          {
            tenantId,
            conversationId: cnv.id,
            direction: 'outbound',
            body: out.replyText,
            deliveryState: 'delivered',
            createdAt: clock.nowMs(),
          },
          clock,
        )
      }
      clock.set(clock.nowMs() + 500)
      return out
    }

    const p1 = await runTurn('qnto custa?')
    const p2 = await runTurn('mas qual o valor da drenagem? antes de marcar')
    const p3 = await runTurn('vc nao responde o q eu pergunto ne')

    expect(p1.replyText).toMatch(/160/)
    expect(p2.replyText).toMatch(/160/)
    expect(p2.replyText).not.toMatch(/hor[aá]rio|qual horário/i)
    expect(p2.replyText?.trim()).not.toBe(p1.replyText?.trim())
    expect(p3.replyText).toMatch(/desculp|entendi mal/i)
    expect(p3.replyText).toMatch(/160/)
    expect(p3.replyText).not.toMatch(/qual horário/i)
    boot.close()
  })
})