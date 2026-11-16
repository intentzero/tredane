/**
 * Staging 16/11 — rsamp_f5237ad7 (P21/P13).
 * P21: «sim, sexta dia 20» não reenvia a mesma lista de remarcação.
 * P13: com lista Horários pendente, frustração não reoferece slots.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import {
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { saveBookingFrame } from './schedule-session'
import {
  affirmsOfferedDayWithoutTime,
  phraseAckDayPickTime,
  phraseOfferSlots,
  tryAiReschedule,
} from './reschedule'
import { tryAiAutoBook } from './autobook'
import { loadTurnContext } from './turn-context'
import { outboundBodiesDuplicate } from './turn-misunderstanding'
import { offerFramePatch } from './deferred-booking-frame'

const TZ = 'America/Sao_Paulo'
/** Domingo 16/11/2026 ~10h BRT — alinhado ao snapshot (turnos após marcação). */
const NOW = zonedCivilToUtc(TZ, 2026, 11, 16, 10, 0)

function seedDrenagem() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-rsamp-f5237ad7'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_rsamp',
      phoneNumberId: 'p1',
      wabaId: 'w1',
      displayPhone: '+5511999990045',
      displayName: 'Demo',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Conceição Ribeiro', homeRoomId: room.id },
    clock,
  )
  const drenagem = upsertServiceOp(
    db,
    caller,
    {
      name: 'Drenagem linfática',
      durationMinutes: 45,
      bufferMinutes: 0,
      priceCents: 16_000,
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
    drenagem.id,
    [{ name: 'Sessão', audience: 'ambos', durationMinutes: 45, priceCents: 16_000 }],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1140 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5500000001045', displayName: 'Aline' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const tue0900 = zonedCivilToUtc(TZ, 2026, 11, 17, 9, 0)
  confirmAppointmentOp(
    db,
    caller,
    {
      clientRequestId: 'rsamp-seed-tue',
      serviceId: drenagem.id,
      professionalId: pro.id,
      startsAt: tue0900,
      contactId: contact.id,
      conversationId: cnv.id,
      actorClerkUserId: caller.actorId!,
      zoneIds: zones.map((z) => z.id),
    },
    clock,
  )
  return { ...boot, clock, db, tenantId, caller, cnv, contact, drenagem, pro, zones }
}

describe('P21 — sim sexta dia 20 não repete lista de remarcação', () => {
  it('affirmsOfferedDayWithoutTime resolve sexta', () => {
    expect(affirmsOfferedDayWithoutTime('sim, sexta dia 20', '2026-11-16')).toBe('2026-11-20')
  })

  it('após oferta idêntica, confirma o dia e pede hora', async () => {
    const s = seedDrenagem()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.drenagem.id,
          date: '2026-11-20',
          period: 'manha',
          phase: 'remarcando',
        },
        s.clock,
      )
      const first = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'nao, terca nao vou poder. sexta de manha tem?',
      })
      expect(first).not.toBeNull()
      const offerBody = first!.replyText
      expect(offerBody).toMatch(/sexta 20\/11/i)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'outbound',
          body: offerBody,
          deliveryState: 'delivered',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      s.clock.advance(30_000)
      const second = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'sim, sexta dia 20',
      })
      expect(second).not.toBeNull()
      expect(second!.replyText).not.toBe(offerBody)
      expect(outboundBodiesDuplicate(second!.replyText, offerBody)).toBe(false)
      expect(second!.replyText).toMatch(/sexta 20\/11/i)
      expect(second!.replyText).toMatch(/horário/i)
      expect(second!.replyText).toBe(phraseAckDayPickTime('2026-11-20'))
    } finally {
      s.close()
    }
  })

  it('phraseOfferSlots duplicado cai no ack (unitário)', () => {
    const body = phraseOfferSlots('2026-11-20', '09:00, 09:15, 09:30')
    expect(outboundBodiesDuplicate(body, body)).toBe(true)
    expect(phraseAckDayPickTime('2026-11-20')).not.toBe(body)
  })
})

describe('P13 — frustração com Horários pendente', () => {
  it('não reoferece a mesma lista de amanhã', async () => {
    const s = seedDrenagem()
    try {
      const slots = [
        {
          date: '2026-11-17',
          time: '09:00',
          startsAt: zonedCivilToUtc(TZ, 2026, 11, 17, 9, 0),
          professionalId: s.pro.id,
        },
        {
          date: '2026-11-17',
          time: '09:30',
          startsAt: zonedCivilToUtc(TZ, 2026, 11, 17, 9, 30),
          professionalId: s.pro.id,
        },
        {
          date: '2026-11-17',
          time: '10:00',
          startsAt: zonedCivilToUtc(TZ, 2026, 11, 17, 10, 0),
          professionalId: s.pro.id,
        },
      ]
      const offerBody =
        'Os horários disponíveis para amanhã são 09:00, 09:30, 10:00. Algum serve?'
      const outMsg = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'outbound',
          body: offerBody,
          deliveryState: 'delivered',
          createdAt: s.clock.nowMs() - 60_000,
        },
        s.clock,
      )
      const patch = offerFramePatch({
        serviceId: s.drenagem.id,
        phase: 'ofertado',
        slots,
      })
      if (patch.pending) patch.pending.messageId = outMsg.id
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          ...patch,
          variantIds: s.zones.map((z) => z.id),
          catalogVersion: 'v1',
        },
        s.clock,
      )
      const inbound = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'vc nao responde o q eu pergunto ne',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const turn = loadTurnContext(
        s.db,
        s.tenantId,
        {
          conversationId: s.cnv.id,
          contactId: s.contact.id,
          messageId: inbound.id,
          inboundBody: inbound.body,
        },
        s.clock,
      )
      const out = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        enabled: true,
        capability: true,
        turn,
        confirmationMessageIdOverride: inbound.id,
      })
      expect(out.replyText ?? '').not.toBe(offerBody)
      expect(out.replyText ?? '').not.toMatch(/09:00, 09:30, 10:00/)
      expect(out.replyText ?? '').toMatch(/confusão|Desculpe|reformular|equipe/i)
      expect(out.interactive?.mode).not.toBe('list')
    } finally {
      s.close()
    }
  })
})