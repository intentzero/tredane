/**
 * Regressão P20/P20 — triagem staging 16/11/2026 (Clínica Bella Pele demo).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import {
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertKnowledgeCategoryOp,
  upsertKnowledgeEntryOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { readReviewFlag } from '../inbox/review-flag'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { tryAiAutoBook } from './autobook'
import { PAYMENT_METHOD_REPLY } from './client-copy'
import { PAYMENT_METHOD_REPLY_REPEAT } from './payment-method-turn'
import { loadTurnContext } from './turn-context'
import { saveBookingFrame } from './schedule-session'
import { zonedCivilToUtc } from '../scheduling'
import { isClientNotAnsweredComplaint } from './client-frustration-turn'

const TZ = 'America/Sao_Paulo'

describe('P20 — parcelamento sem cadastro', () => {
  it('1ª pergunta: equipe avisada; 2ª: texto diferente (sem eco)', async () => {
    const clock = createControllableClock(Date.UTC(2026, 10, 12, 14, 0))
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-p20-pay'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_p20',
        phoneNumberId: 'p_p20',
        wabaId: 'w_p20',
        displayPhone: '+55119000010815',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Samua' }, clock)
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
  setWeeklyWindowsOp(
    db,
    caller,
    { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1080 }] },
    clock,
  )
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(db, { tenantId, waId: '55119000010815', displayName: 'Tati' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    saveBookingFrame(
      db,
      tenantId,
      cnv.id,
      { serviceId: preenchimento.id, phase: 'coletando' },
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
      clock.set(clock.nowMs() + 1000)
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
      return tryAiAutoBook(db, caller, clock, {
        conversationId: cnv.id,
        enabled: true,
        capability: true,
        turn,
        confirmationMessageIdOverride: inbound.id,
      })
    }

    const first = await runTurn('vcs aceitam cartao? da pra parcelar o preenchimento?')
    expect(first.replyText ?? '').toMatch(/cart[aã]o|parcelamento|equipe confirma/i)
    expect(readReviewFlag(db, tenantId, cnv.id)?.flaggedAt).not.toBeNull()
    expect((first.replyText ?? '').trim()).toContain(PAYMENT_METHOD_REPLY.trim().slice(0, 20))

    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'outbound',
        body: first.replyText ?? PAYMENT_METHOD_REPLY,
        deliveryState: 'delivered',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    clock.set(clock.nowMs() + 2000)

    const second = await runTurn('mas e o parcelamento??')
    expect(second.replyText ?? '').toContain(PAYMENT_METHOD_REPLY_REPEAT)
    expect(second.replyText ?? '').not.toBe(first.replyText)

    boot.close()
  })

  it('com FAQ de pagamento publicada, responde o cadastro', async () => {
    const clock = createControllableClock(Date.UTC(2026, 10, 12, 14, 0))
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-p20-faq'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_p20b',
        phoneNumberId: 'p_p20b',
        wabaId: 'w_p20b',
        displayPhone: '+55119000010816',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const cat = upsertKnowledgeCategoryOp(db, caller, { name: 'Pagamento' }, clock)
    upsertKnowledgeEntryOp(
      db,
      caller,
      {
        categoryId: cat.id,
        question: 'Aceitam cartão?',
        answer: 'Aceitamos cartão em até 6x sem juros no consultório.',
        matchCues: ['cartão', 'parcelamento', 'parcelar'],
        status: 'published',
      },
      clock,
    )
    const contact = upsertContact(db, { tenantId, waId: '55119000010816' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    const inbound = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body: 'vcs aceitam cartao?',
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
    expect(out.replyText ?? '').toMatch(/6x|cart[aã]o/)
    expect(out.replyText ?? '').not.toMatch(/equipe confirma com voc[eê]/i)
    boot.close()
  })
})

describe('P21 — frustração «vc nao responde»', () => {
  it('não reoferta horários; responde preço e oferece equipe', async () => {
    const NOW = Date.UTC(2026, 10, 12, 14, 0)
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-p21-frust'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_p21',
        phoneNumberId: 'p_p21',
        wabaId: 'w_p21',
        displayPhone: '+5511900001045',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
    const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Conceição', homeRoomId: room.id }, clock)
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
    const contact = upsertContact(db, { tenantId, waId: '5511900001045', displayName: 'Aline' }, clock)
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
          messageId: 'offer-p21',
        },
        pending: {
          slot: 'horario',
          options: [{ key: '2026-11-17T09:00', label: '09:00' }],
          messageId: 'offer-p21',
        },
      },
      clock,
    )
    expect(isClientNotAnsweredComplaint('vc nao responde o q eu pergunto ne')).toBe(true)
    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body: 'qnto custa?',
        deliveryState: 'received',
        createdAt: clock.nowMs() - 3000,
      },
      clock,
    )
    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'outbound',
        body: 'Para Drenagem linfática, o valor é R$ 160,00.',
        deliveryState: 'delivered',
        createdAt: clock.nowMs() - 2000,
      },
      clock,
    )
    const inbound = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body: 'vc nao responde o q eu pergunto ne',
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
    expect(reply).toMatch(/desculp|entendi mal/i)
    expect(reply).toMatch(/160,00|R\$\s*160/)
    expect(reply).not.toMatch(/hor[aá]rios?\s+dispon[ií]veis/i)
    expect(out.interactive?.mode === 'buttons' ? out.interactive.buttons?.length : 0).toBeGreaterThan(0)
    boot.close()
  })
})