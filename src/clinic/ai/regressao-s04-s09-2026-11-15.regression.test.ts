/**
 * Regressão f908ba1b — itens (b) S04 incompreensões/repetição e (e) horários informais.
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
import { zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { tryAiAutoBook } from './autobook'
import { matchOfferedSlotFromText } from './booking-frame-choice'
import {
  bumpMisunderstandingStreak,
  detectTurnMisunderstanding,
  maybeEscalateMisunderstanding,
  outboundBodiesDuplicate,
} from './turn-misunderstanding'
import { realizeAskInfo } from './ask-info-realize'
import { extractTimes, parseTemporal } from './nlu/temporal'
import { getBookingFrame, saveBookingFrame } from './schedule-session'
import { loadTurnContext } from './turn-context'

const TZ = 'America/Sao_Paulo'

describe('(e) horários informais', () => {
  it('«dps das 4» → período tarde (sem fallback DEC-107)', () => {
    const p = parseTemporal('tem mais tarde? tipo dps das 4', { civilDate: '2026-11-15' })
    expect(p.periods).toContain('tarde')
    expect(p.times).toEqual([])
  })

  it('«12 e 30 ue» e «12h30 de amanha» extraem 12:30', () => {
    expect(extractTimes('12 e 30 ue')).toEqual(new Set(['12:30']))
    expect(parseTemporal('12h30 de amanha ue', { civilDate: '2026-11-15' }).times).toEqual(['12:30'])
  })

  it('«amanhã 12:30» casa com lastOffer', () => {
    const starts = zonedCivilToUtc(TZ, 2026, 11, 16, 12, 30)
    const r = matchOfferedSlotFromText(
      'amanha 12:30',
      {
        slot: 'horario',
        options: [{ key: '2026-11-16T12:30', label: '12:30' }],
        messageId: 'm1',
      },
      { slots: [{ startsAt: starts, professionalId: 'pro' }], messageId: 'm1' },
      TZ,
      '2026-11-15',
    )
    expect(r.kind).toBe('match')
    if (r.kind === 'match') expect(r.key).toBe('2026-11-16T12:30')
  })
})

describe('(b) incompreensões consecutivas e sem repetição', () => {
  it('deteta a mesma lista e escalada ao 2.º turno', () => {
    const list =
      'Os horários disponíveis para terça 17/11 são 12:30, 13:00. Algum serve?'
    expect(outboundBodiesDuplicate(list, list)).toBe(true)
    expect(
      detectTurnMisunderstanding({
        inboundBody: 'qnto custa?',
        outboundBody: list,
        priorOutboundBody: list,
      }),
    ).toBe('duplicate_outbound')

    const clock = createControllableClock(Date.UTC(2026, 10, 15, 15, 0))
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-mis-streak'
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_mis',
        phoneNumberId: 'p_mis',
        wabaId: 'w_mis',
        displayPhone: '+5511999990001',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const contact = upsertContact(db, { tenantId, waId: '5511999990001' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    const s1 = bumpMisunderstandingStreak(db, tenantId, cnv.id, clock)
    expect(s1).toBe(1)
    const s2 = bumpMisunderstandingStreak(db, tenantId, cnv.id, clock)
    const esc = maybeEscalateMisunderstanding(
      db,
      tenantId,
      { conversationId: cnv.id, messageId: 'msg-2', streak: s2 },
      clock,
    )
    expect(esc.escalate).toBe(true)
    expect(s2).toBe(2)
    boot.close()
  })

  it('S04: «qnto custa?» com oferta aberta responde preço (não só a lista)', async () => {
    const NOW = Date.UTC(2026, 10, 12, 14, 0)
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-s04-fix'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_s04_fix',
        phoneNumberId: 'p1',
        wabaId: 'w1',
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
    const zones = replaceServiceZonesOp(
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
    saveBookingFrame(
      db,
      tenantId,
      cnv.id,
      {
        serviceId: drenagem.id,
        date: '2026-11-17',
        phase: 'ofertado',
        lastOffer: {
          slots: [{ startsAt: zonedCivilToUtc(TZ, 2026, 11, 17, 12, 30), professionalId: pro.id }],
          messageId: 'offer-1',
        },
        pending: { slot: 'horario', options: [{ key: '2026-11-17T12:30', label: '12:30' }], messageId: 'offer-1' },
      },
      clock,
    )
    const quote = realizeAskInfo({
      conversationId: cnv.id,
      topic: 'price',
      service: { ...drenagem, zones, active: true } as never,
      zones,
      frame: getBookingFrame(db, tenantId, cnv.id),
      sameFunnel: true,
    })
    expect(quote?.replyText ?? '').toMatch(/160,00|R\$\s*160/)

    const inbound = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body: 'qnto custa?',
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
    expect(out.replyText ?? '').toMatch(/160,00|R\$\s*160/)
    boot.close()
  })
})