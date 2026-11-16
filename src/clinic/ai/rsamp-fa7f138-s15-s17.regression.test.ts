/**
 * rsamp_fa7f138 / cnv_3fa91176 (15/11/2026 staging) — FAQ e preço não são passo de zona/slot.
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
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { tryAiAutoBook } from './autobook'
import { findExplicitServiceInText } from './booking-object'
import { classifyCrossCuttingAct } from './booking-turn-gate'
import { isCatalogClarificationAsk } from './faq-clarification'
import { loadTurnContext } from './turn-context'
import { saveBookingFrame } from './schedule-session'

function seedDepilacaoMidZones(now: number) {
  const clock = createControllableClock(now)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-s15-faq-zona'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_s15',
      phoneNumberId: 'p_s15',
      wabaId: 'w_s15',
      displayPhone: '+5511900001150',
      displayName: 'C',
      action: 'channel_connected',
    },
    clock,
  )
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Luiza' }, clock)
  const depi = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 15,
      bufferMinutes: 0,
      priceCents: null,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      variantSelection: 'varias',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
      clientExplanation: null,
    },
    clock,
  )
  const zones = replaceServiceZonesOp(
    db,
    caller,
    depi.id,
    [
      {
        name: 'Intima',
        audience: 'feminino',
        durationMinutes: 20,
        priceCents: 18_000,
        clientExplanation: 'Inclui virilha e ânus no feminino.',
      },
      {
        name: 'Axila',
        audience: 'feminino',
        durationMinutes: 15,
        priceCents: 5_000,
      },
      { name: 'Pernas', audience: 'feminino', durationMinutes: 30, priceCents: 11_000 },
    ],
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [1, 2, 3, 4, 5].map((d) => ({
        dayOfWeek: d,
        startMinute: 540,
        endMinute: 19 * 60,
      })),
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900001150', displayName: 'Paulo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const askMsg = insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'outbound',
      body: 'Quais zonas? Temos axila, pernas, intima…',
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
      serviceId: depi.id,
      line: 'feminino',
      variantIds: [zones.find((z) => z.name === 'Axila')!.id],
      phase: 'coletando',
      pending: {
        slot: 'acumular',
        options: [],
        messageId: askMsg.id,
      },
    },
    clock,
  )
  return { ...boot, clock, tenantId, caller, cnv, db, depi, zones }
}

describe('S15 — FAQ «Como é a íntima?» no meio das zonas', () => {
  it('classifica como explicação (não leftover)', () => {
    expect(isCatalogClarificationAsk('Como é a íntima?')).toBe(true)
    expect(classifyCrossCuttingAct({ text: 'Como é a íntima?' }).kind).toBe('ask_info')
  })

  it('responde FAQ e retoma zonas sem «Não encontrei como»', async () => {
    const s = seedDepilacaoMidZones(Date.UTC(2026, 10, 15, 15, 0))
    try {
      const inbound = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'Como é a íntima?',
          deliveryState: 'received',
          createdAt: s.clock.nowMs() + 1,
        },
        s.clock,
      )
      const turn = loadTurnContext(
        s.db,
        s.tenantId,
        {
          conversationId: s.cnv.id,
          contactId: s.cnv.contactId,
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
      const reply = out.replyText ?? ''
      expect(reply).toMatch(/virilha|ânus|cadastro/i)
      expect(reply).not.toMatch(/Não encontrei como/i)
      expect(reply).toMatch(/zonas|axila|pernas|intima/i)
    } finally {
      s.close()
    }
  })
})

describe('S16 — preço cita outro serviço', () => {
  it('findExplicitServiceInText destaca bronzeamento', () => {
    const massagem = {
      id: 'm',
      active: true,
      name: 'Massagem relaxante',
      synonyms: [],
      zones: [],
    } as const
    const bronze = {
      id: 'b',
      active: true,
      name: 'Bronzeamento artificial',
      synonyms: [],
      zones: [{ id: 'z1', active: true, name: 'Sessão', durationMinutes: 30, priceCents: 12_000 }],
    } as const
    expect(
      findExplicitServiceInText('Qual o valor do bronzeamento?', [massagem, bronze] as never)?.id,
    ).toBe('b')
  })

  it('preço do bronzeamento não usa valores da massagem no quadro', async () => {
    const NOW = Date.UTC(2026, 10, 15, 15, 0)
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-s16-preco-servico'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_s16',
        phoneNumberId: 'p_s16',
        wabaId: 'w_s16',
        displayPhone: '+5511900001160',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Luiza' }, clock)
    const massagem = upsertServiceOp(
      db,
      caller,
      {
        name: 'Massagem relaxante',
        durationMinutes: 60,
        bufferMinutes: 0,
        priceCents: 18_000,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    upsertServiceOp(
      db,
      caller,
      {
        name: 'Bronzeamento artificial',
        durationMinutes: 30,
        bufferMinutes: 0,
        priceCents: 12_000,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
        clientExplanation: 'Bronze em cabine com tempo de secagem.',
      },
      clock,
    )
    setWeeklyWindowsOp(
      db,
      caller,
      {
        resourceId: pro.id,
        windows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 19 * 60 }],
      },
      clock,
    )
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(db, { tenantId, waId: '5511900001160', displayName: 'Paulo' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    saveBookingFrame(
      db,
      tenantId,
      cnv.id,
      { serviceId: massagem.id, phase: 'coletando' },
      clock,
    )
    const inbound = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body: 'Qual o valor do bronzeamento?',
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
    expect(reply).toMatch(/R\$\s*120,00|120,00/)
    expect(reply).not.toMatch(/R\$\s*180,00|180,00/)
    boot.close()
  })
})

describe('S17 — info serviço sem oferta de horário', () => {
  it('responde explicação sem lista de horários', async () => {
    const NOW = Date.UTC(2026, 10, 15, 15, 0)
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-s17-info'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_s17',
        phoneNumberId: 'p_s17',
        wabaId: 'w_s17',
        displayPhone: '+5511900001170',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Luiza' }, clock)
    upsertServiceOp(
      db,
      caller,
      {
        name: 'Bronzeamento artificial',
        durationMinutes: 30,
        bufferMinutes: 0,
        priceCents: 12_000,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
        clientExplanation: 'Bronze em cabine com tempo de secagem.',
      },
      clock,
    )
    setWeeklyWindowsOp(
      db,
      caller,
      {
        resourceId: pro.id,
        windows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 19 * 60 }],
      },
      clock,
    )
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(db, { tenantId, waId: '5511900001170', displayName: 'Paulo' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    const inbound = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body: 'Quero saber como é o bronzeamento',
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
    expect(reply).toMatch(/cabine|Bronze|cadastro/i)
    expect(reply).not.toMatch(/09:00|09:30|10:00|tenho amanhã/i)
    expect(out.interactive).toBeUndefined()
    boot.close()
  })
})