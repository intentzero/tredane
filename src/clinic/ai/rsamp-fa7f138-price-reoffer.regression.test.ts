/**
 * Regressão rsamp_fa7f138 — após «Qual o valor?» com oferta aberta, reofertar
 * horários (não só «qual horário você prefere?»).
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
import { saveBookingFrame } from './schedule-session'
import { loadTurnContext } from './turn-context'

const TZ = 'America/Sao_Paulo'
const NOW = Date.UTC(2026, 10, 12, 14, 0)

describe('rsamp_fa7f138 — preço + reoferta de slots', () => {
  it('«Qual o valor?» devolve preço e lista de horários', async () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-fa7f138-price'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_price',
        phoneNumberId: 'p_price',
        wabaId: 'w_price',
        displayPhone: '+5511900000097',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
    const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Samua', homeRoomId: room.id }, clock)
    const depil = upsertServiceOp(
      db,
      caller,
      {
        name: 'Depilação',
        durationMinutes: 50,
        bufferMinutes: 0,
        priceCents: null,
        variantKind: 'zona',
        variantKindPlural: 'zonas',
        variantSelection: 'varias',
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    const zones = replaceServiceZonesOp(
      db,
      caller,
      depil.id,
      [
        { name: 'Perna', audience: 'feminino', durationMinutes: 25, priceCents: 20_000 },
        { name: 'Virilha', audience: 'feminino', durationMinutes: 25, priceCents: 20_000 },
      ],
      clock,
    )
    const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 }))
    setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
    setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(db, { tenantId, waId: '5511900000097', displayName: 'Cliente' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const offerMsg = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'outbound',
        body: 'Para Depilação, tenho amanhã às 13:00 e 14:00. Qual prefere?',
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
        serviceId: depil.id,
        variantIds: zones.map((z) => z.id),
        line: 'feminino',
        date: '2026-11-13',
        phase: 'ofertado',
        pending: { slot: 'horario', options: [{ key: 'k', label: 'l' }], messageId: offerMsg.id },
        lastOffer: {
          slots: [{ startsAt: zonedCivilToUtc(TZ, 2026, 11, 13, 13, 0), professionalId: pro.id }],
          messageId: offerMsg.id,
        },
      },
      clock,
    )
    const inbound = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body: 'Qual o valor?',
        deliveryState: 'received',
        createdAt: clock.nowMs() + 1000,
      },
      clock,
    )
    const turn = loadTurnContext(
      db,
      tenantId,
      { conversationId: cnv.id, contactId: contact.id, messageId: inbound.id, inboundBody: inbound.body },
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
    expect(reply).toMatch(/R\$\s*400,00|400,00/)
    expect(reply).toMatch(/\d{1,2}:\d{2}/)
    expect(reply).toMatch(/horários disponíveis|tenho/i)
    expect(reply).not.toMatch(/qual horário você prefere\?$/i)
    boot.close()
  })
})
