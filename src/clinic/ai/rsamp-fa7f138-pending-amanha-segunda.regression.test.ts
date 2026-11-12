/**
 * Regressão rsamp_fa7f138 (staging 12/11/2026) — oferta pendente em amanhã +
 * «Na próxima segunda tem horário?» (sem proposta; caminho offerNearestSlots).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { tryAiAutoBook } from './autobook'
import { getBookingFrame, saveBookingFrame } from './schedule-session'
import { loadTurnContext } from './turn-context'

const TZ = 'America/Sao_Paulo'
const NOW = Date.UTC(2026, 10, 12, 13, 41)

describe('rsamp_fa7f138 — oferta amanhã + próxima segunda (sem proposta)', () => {
  it('reoferece na segunda, não repete amanhã', async () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-fa7f138-pending-seg'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    try {
      syncWhatsappChannel(
        db,
        tenantId,
        {
          status: 'connected',
          bindingId: 'b_pend_seg',
          phoneNumberId: 'p_pend_seg',
          wabaId: 'w_pend_seg',
          displayPhone: '+5511900000095',
          displayName: 'C',
          action: 'channel_connected',
        },
        clock,
      )
      const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Samua', homeRoomId: room.id }, clock)
      const massagem = upsertServiceOp(
        db,
        caller,
        {
          name: 'Massagem',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 20000,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      const zones = replaceServiceZonesOp(
        db,
        caller,
        massagem.id,
        [{ name: 'Relaxante', audience: 'ambos', durationMinutes: 60, priceCents: 20000 }],
        clock,
      )
      const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 }))
      setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
      setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
      setClinicAiAssistEnabled(db, tenantId, true, clock)
      const contact = upsertContact(db, { tenantId, waId: '5511900000095', displayName: 'Cliente' }, clock)
      const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
      const offerMsg = insertMessage(
        db,
        {
          tenantId,
          conversationId: cnv.id,
          direction: 'outbound',
          body: 'Tenho amanhã às 13:00, 13:30, 14:00 para Relaxante. Qual prefere?',
          deliveryState: 'delivered',
          createdAt: clock.nowMs(),
        },
        clock,
      )
      saveBookingFrame(
        db,
        tenantId,
        cnv.id,
        {
          serviceId: massagem.id,
          variantIds: [zones[0]!.id],
          date: '2026-11-13',
          phase: 'ofertado',
          pending: {
            slot: 'horario',
            options: [{ key: '2026-11-13T13:00', label: 'sexta 13/11 13:00' }],
            messageId: offerMsg.id,
          },
          lastOffer: {
            slots: [{ startsAt: zonedCivilToUtc(TZ, 2026, 11, 13, 13, 0), professionalId: pro.id }],
            messageId: offerMsg.id,
          },
        },
        clock,
      )
      clock.advance(60_000)
      const inbound = insertMessage(
        db,
        {
          tenantId,
          conversationId: cnv.id,
          direction: 'inbound',
          body: 'Na próxima segunda tem horário?',
          deliveryState: 'received',
          createdAt: clock.nowMs(),
        },
        clock,
      )
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
      const reply = out.replyText ?? ''
      expect(reply).toMatch(/segunda|16\/11/i)
      expect(reply).not.toMatch(/horários disponíveis para amanhã/i)
      out.deferredFrame?.flushNow(db, tenantId, cnv.id, clock)
      expect(getBookingFrame(db, tenantId, cnv.id)?.date).toBe('2026-11-16')
    } finally {
      boot.close()
    }
  })
})
