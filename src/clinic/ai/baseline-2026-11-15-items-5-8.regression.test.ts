/**
 * Baseline conversacional 15/11/2026 — itens 5–8 (P6–P9 parcial).
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
import { tryAiAutoBook } from './autobook'
import { resolveBookingObject, listBookableOptions } from './booking-object'
import { isCatalogInfoAsk, isPaymentMethodAsk } from './booking-intent-text'
import { classifyCrossCuttingAct } from './booking-turn-gate'
import { parseTemporal, extractTimes } from './nlu/temporal'
import { tryAiReschedule } from './reschedule'
import { saveBookingFrame, getBookingFrame } from './schedule-session'
import { loadTurnContext } from './turn-context'

const TZ = 'America/Sao_Paulo'

describe('item 8 — meio dia e meia', () => {
  it('parseia 12:30 em pt-BR falado', () => {
    expect(extractTimes('meio dia e meia ta bom sim')).toEqual(new Set(['12:30']))
    expect(parseTemporal('meio-dia e meia', { civilDate: '2026-11-15' }).times).toEqual(['12:30'])
    expect(parseTemporal('meio dia', { civilDate: '2026-11-15' }).times).toEqual(['12:00'])
  })
})

describe('item 5 — preço e pagamento', () => {
  it('«qnto custa?» classifica como preço', () => {
    expect(isCatalogInfoAsk('qnto custa?')).toBe(true)
    expect(classifyCrossCuttingAct({ text: 'qnto custa?' }).kind).toBe('ask_info')
  })

  it('parcelamento classifica como pagamento, não preço', () => {
    expect(isPaymentMethodAsk('vcs aceitam cartao? da pra parcelar o preenchimento?')).toBe(true)
    expect(isCatalogInfoAsk('mas e o parcelamento??')).toBe(false)
  })

  it('preço a meio do funil responde valor e reoferta horários', async () => {
    const NOW = Date.UTC(2026, 10, 12, 14, 0)
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-baseline-s04-price'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_s04',
        phoneNumberId: 'p_s04',
        wabaId: 'w_s04',
        displayPhone: '+5511900000204',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
    const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Samua', homeRoomId: room.id }, clock)
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
    replaceServiceZonesOp(
      db,
      caller,
      drenagem.id,
      [{ name: 'Sessão', audience: 'ambos', durationMinutes: 45, priceCents: 16_000 }],
      clock,
    )
    const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 }))
    setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
    setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(db, { tenantId, waId: '5511900000204', displayName: 'Aline' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    const offerMsg = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'outbound',
        body: 'Para Drenagem linfática, tenho terça às 12:30, 13:00 e 15:15. Qual prefere?',
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
        serviceId: drenagem.id,
        variantIds: [db.get<{ id: string }>(`SELECT id FROM service_zones WHERE service_id = ? LIMIT 1`, drenagem.id)!.id],
        date: '2026-11-17',
        phase: 'ofertado',
        pending: { slot: 'horario', options: [{ key: 'k', label: 'l' }], messageId: offerMsg.id },
        lastOffer: {
          slots: [{ startsAt: zonedCivilToUtc(TZ, 2026, 11, 17, 12, 30), professionalId: pro.id }],
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
        body: 'qnto custa?',
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
    expect(out.replyText ?? '').toMatch(/R\$\s*160,00|160,00/)
    expect(out.replyText ?? '').toMatch(/\d{1,2}:\d{2}/)
    boot.close()
  })

  it('parcelamento responde e não repete só horários ignorando a pergunta', async () => {
    const NOW = Date.UTC(2026, 10, 12, 14, 0)
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-baseline-s08b-pay'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_s08b',
        phoneNumberId: 'p_s08b',
        wabaId: 'w_s08b',
        displayPhone: '+5511900001081',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
    const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Samua', homeRoomId: room.id }, clock)
    const preenchimento = upsertServiceOp(
      db,
      caller,
      {
        name: 'Preenchimento labial',
        durationMinutes: 30,
        bufferMinutes: 0,
        priceCents: 120_000,
        variantKind: 'tipo',
        variantKindPlural: 'tipos',
        variantSelection: 'uma',
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    replaceServiceZonesOp(
      db,
      caller,
      preenchimento.id,
      [{ name: 'Sessão', audience: 'ambos', durationMinutes: 30, priceCents: 120_000 }],
      clock,
    )
    const week = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 }))
    setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(db, { tenantId, waId: '5511900001081', displayName: 'Tati' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    saveBookingFrame(
      db,
      tenantId,
      cnv.id,
      {
        serviceId: preenchimento.id,
        phase: 'coletando',
      },
      clock,
    )
    const inbound = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body: 'vcs aceitam cartao? da pra parcelar o preenchimento?',
        deliveryState: 'received',
        createdAt: clock.nowMs(),
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
    expect(reply).toMatch(/cart[aã]o|parcelamento|equipe confirma/i)
    expect(reply).not.toMatch(/^Para preenchimento labial, tenho amanh/i)
    boot.close()
  })
})

describe('item 7 — pedido vago e indicação', () => {
  it('«semana que vem» não vira handoff por «semana» inexistente', () => {
    const services = [
      {
        id: 's1',
        active: true,
        name: 'Avaliação estética',
        durationMinutes: 30,
        priceCents: 0,
        audiencia: 'qualquer' as const,
        zones: [],
        variantKind: null,
        variantKindPlural: null,
        variantSelection: 'uma' as const,
        professionalIds: [],
        synonyms: null,
      },
      {
        id: 's2',
        active: true,
        name: 'Limpeza de pele profunda',
        durationMinutes: 60,
        priceCents: 18_000,
        audiencia: 'qualquer' as const,
        zones: [],
        variantKind: null,
        variantKindPlural: null,
        variantSelection: 'uma' as const,
        professionalIds: [],
        synonyms: null,
      },
    ]
    const r = resolveBookingObject({
      text: 'oii queria marcar algo pra semana que vem',
      services: services as never,
    })
    expect(r.handoffReason).not.toBe('inexistente')
    expect(r.kind).toBe('clarify')
  })

  it('indicação para pele sugere avaliação gratuita', () => {
    const services = listBookableOptions([
      {
        id: 'av',
        active: true,
        name: 'Avaliação estética',
        durationMinutes: 30,
        priceCents: 0,
        audiencia: 'qualquer',
        zones: [],
        variantKind: null,
        variantKindPlural: null,
        variantSelection: 'uma',
        professionalIds: [],
        synonyms: null,
      },
      {
        id: 'lp',
        active: true,
        name: 'Limpeza de pele profunda',
        durationMinutes: 60,
        priceCents: 18_000,
        audiencia: 'qualquer',
        zones: [],
        variantKind: null,
        variantKindPlural: null,
        variantSelection: 'uma',
        professionalIds: [],
        synonyms: null,
      },
    ] as never)
    void services
    const r = resolveBookingObject({
      text: 'ah nao sei bem.. oq vc indica pra pele? ta meio manchada',
      services: [
        {
          id: 'av',
          active: true,
          name: 'Avaliação estética',
          durationMinutes: 30,
          priceCents: 0,
          audiencia: 'qualquer',
          zones: [],
          variantKind: null,
          variantKindPlural: null,
          variantSelection: 'uma',
          professionalIds: [],
          synonyms: null,
        },
        {
          id: 'lp',
          active: true,
          name: 'Limpeza de pele profunda',
          durationMinutes: 60,
          priceCents: 18_000,
          audiencia: 'qualquer',
          zones: [],
          variantKind: null,
          variantKindPlural: null,
          variantSelection: 'uma',
          professionalIds: [],
          synonyms: null,
        },
      ] as never,
    })
    expect(r.question ?? '').toMatch(/Avaliação estética|avaliação/i)
    expect(r.question ?? '').toMatch(/gratuita/i)
  })
})

describe('item 6 — remarcação mudando data', () => {
  const NOW = Date.UTC(2026, 10, 14, 15, 0) // dom 15/11 12:00 SP

  function seedReschedule() {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-baseline-s05a-rs'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_s05a',
        phoneNumberId: 'p_s05a',
        wabaId: 'w_s05a',
        displayPhone: '+5511900000104',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
    const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Samua', homeRoomId: room.id }, clock)
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
    const contact = upsertContact(db, { tenantId, waId: '5511900000104', displayName: 'Aline' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId: 'seed-s05a',
        serviceId: drenagem.id,
        professionalId: pro.id,
        startsAt: zonedCivilToUtc(TZ, 2026, 11, 17, 15, 15),
        contactId: contact.id,
        conversationId: cnv.id,
        actorClerkUserId: caller.actorId!,
        zoneIds: zones.map((z) => z.id),
      },
      clock,
    )
    return { ...boot, clock, tenantId, caller, cnv, db, drenagem }
  }

  it('troca terça por sexta de manhã oferece vagas na sexta', async () => {
    const s = seedReschedule()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.drenagem.id,
          date: '2026-11-17',
          phase: 'remarcando',
        },
        s.clock,
      )
      const out = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'nao, terca nao vou poder. sexta de manha tem?',
      })
      expect(out).not.toBeNull()
      expect(out!.replyText).toMatch(/sexta 20\/11/i)
      expect(out!.replyText).not.toMatch(/terça 17\/11.*não tenho horário livre/i)
      expect(out!.replyText).toMatch(/12:30|13:00|15:15|\d{2}:\d{2}/)
      expect(out!.date).toBe('2026-11-20')
    } finally {
      s.close()
    }
  })
})