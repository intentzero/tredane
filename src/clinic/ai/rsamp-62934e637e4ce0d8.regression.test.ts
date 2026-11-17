/**
 * rsamp_62934e637e4ce0d8 — staging 17/11/2026: «pode me atender esta tarde?»
 * não oferecia horários (redator LLM + «equipe confirma»).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { SimulatedAiAdapter } from '../../ai'
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
import { enqueueAutoDraft, runDueAutoDrafts } from './autodraft'
import { hasSchedulingAvailabilityIntent } from './booking-intent-text'
import { loadTurnContext } from './turn-context'
import { interpretTurn } from './nlu/interpret'
import { parseTemporal } from './nlu/temporal'
import { scheduleFactsFromText } from './schedule-session'

/** Seg 17/11/2026 12:48 BRT → 15:48 UTC */
const NOW = Date.UTC(2026, 10, 17, 15, 48)
const TODAY = '2026-11-17'

const AVAILABILITY_PHRASES = [
  'Você pode me atender esta tarde?',
  'Você pode-me atender esta tarde?',
  'pode me atender hoje à tarde?',
  'tem horário hoje à tarde?',
  'consegue me encaixar hoje de tarde?',
] as const

function seedClinic() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-rsamp-62934e'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_rsamp62934',
      phoneNumberId: 'p_rsamp',
      wabaId: 'w_rsamp',
      displayPhone: '+5511999005500',
      displayName: 'Clínica Teste Sintética',
      action: 'channel_connected',
    },
    clock,
  )
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Luiza' }, clock)
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [1, 2, 3, 4, 5].flatMap((d) => [
        { dayOfWeek: d, startMinute: 9 * 60, endMinute: 18 * 60 },
      ]),
    },
    clock,
  )
  const depi = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação a laser',
      durationMinutes: 15,
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
  replaceServiceZonesOp(
    db,
    caller,
    depi.id,
    [
      {
        name: 'Axila',
        audience: 'feminino',
        durationMinutes: 15,
        priceCents: 5000,
      },
    ],
    clock,
  )
  const massagem = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem relaxante',
      durationMinutes: 50,
      bufferMinutes: 0,
      priceCents: 18_000,
      variantKind: 'tipo',
      variantKindPlural: 'tipos',
      variantSelection: 'uma',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const bronze = upsertServiceOp(
    db,
    caller,
    {
      name: 'Bronzeamento',
      durationMinutes: 45,
      bufferMinutes: 0,
      priceCents: 12_000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '556181882769', displayName: 'Paulo' },
    clock,
  )
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { boot, db, tenantId, caller, clock, depi, massagem, bronze, cnv, contact }
}

async function autoBookReply(
  ctx: ReturnType<typeof seedClinic>,
  body: string,
  priorGreeting = false,
) {
  if (priorGreeting) {
    insertMessage(
      ctx.db,
      {
        tenantId: ctx.tenantId,
        conversationId: ctx.cnv.id,
        direction: 'outbound',
        body: 'Olá! O que você precisa?',
        deliveryState: 'read',
        createdAt: ctx.clock.nowMs() - 2_000,
      },
      ctx.clock,
    )
  }
  const inbound = insertMessage(
    ctx.db,
    {
      tenantId: ctx.tenantId,
      conversationId: ctx.cnv.id,
      direction: 'inbound',
      body,
      deliveryState: 'received',
      createdAt: ctx.clock.nowMs(),
    },
    ctx.clock,
  )
  const turn = loadTurnContext(
    ctx.db,
    ctx.tenantId,
    {
      conversationId: ctx.cnv.id,
      contactId: ctx.cnv.contactId,
      messageId: inbound.id,
      inboundBody: inbound.body,
    },
    ctx.clock,
  )
  const out = await tryAiAutoBook(ctx.db, ctx.caller, ctx.clock, {
    conversationId: ctx.cnv.id,
    enabled: true,
    capability: true,
    turn,
    confirmationMessageIdOverride: inbound.id,
  })
  return { out, inboundId: inbound.id }
}

async function draftReply(ctx: ReturnType<typeof seedClinic>, body: string, priorGreeting = true) {
  if (priorGreeting) {
    insertMessage(
      ctx.db,
      {
        tenantId: ctx.tenantId,
        conversationId: ctx.cnv.id,
        direction: 'outbound',
        body: 'Olá! O que você precisa?',
        deliveryState: 'read',
        createdAt: ctx.clock.nowMs() - 2_000,
      },
      ctx.clock,
    )
  }
  const msg = insertMessage(
    ctx.db,
    {
      tenantId: ctx.tenantId,
      conversationId: ctx.cnv.id,
      direction: 'inbound',
      body,
      deliveryState: 'received',
      createdAt: ctx.clock.nowMs(),
    },
    ctx.clock,
  )
  enqueueAutoDraft(ctx.db, ctx.tenantId, { conversationId: ctx.cnv.id, messageId: msg.id }, ctx.clock)
  ctx.clock.advance(8_000)
  await runDueAutoDrafts(ctx.db, ctx.caller, ctx.clock, {
    mode: 'synthetic',
    adapter: new SimulatedAiAdapter(),
    clinicName: 'Clínica Teste Sintética',
  })
  return (
    ctx.db.get<{ body: string }>(
      `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
      ctx.cnv.id,
    )?.body ?? ''
  )
}

function forbidTeamDeferral(reply: string) {
  expect(reply).not.toMatch(/quem confirma/i)
  expect(reply).not.toMatch(/share\.google/i)
  expect(reply).not.toMatch(/vou pedir para verificarem/i)
  expect(reply).not.toMatch(/^Aqui é a Gioconda\b/i)
}

describe('rsamp_62934e637e4ce0d8 — disponibilidade «esta tarde»', () => {
  it('classifica intenção e dia civil', () => {
    for (const text of AVAILABILITY_PHRASES) {
      expect(hasSchedulingAvailabilityIntent(text)).toBe(true)
      const interp = interpretTurn({
        turnText: text,
        messageId: 'm',
        today: TODAY,
        services: [],
      })
      expect(interp.acts).toContain('marcar')
      expect(interp.slots.period?.value).toBe('tarde')
      const dates = parseTemporal(text, TODAY).dates
      expect(dates).toContain(TODAY)
      expect(scheduleFactsFromText(text).dayLabel).toBe('hoje')
      expect(scheduleFactsFromText(text).period).toBe('tarde')
    }
  })

  it('sem serviço no quadro → pergunta serviço (não redator de exceção)', async () => {
    const ctx = seedClinic()
    try {
      const { out } = await autoBookReply(ctx, 'Você pode me atender esta tarde?', true)
      expect(out.replyText).toBeTruthy()
      forbidTeamDeferral(out.replyText!)
      expect(out.replyText!).toMatch(/serviço|procedimento|Depilação|Massagem/i)
      expect(out.interactive?.mode === 'list' || out.interactive?.mode === 'buttons').toBe(true)
    } finally {
      ctx.boot.close()
    }
  })

  it('com depilação no turno → oferta de horários à tarde (hoje)', async () => {
    const ctx = seedClinic()
    try {
      const { out } = await autoBookReply(ctx, 'Quero bronzeamento hoje à tarde', true)
      expect(out.replyText).toBeTruthy()
      forbidTeamDeferral(out.replyText!)
      expect(out.replyText!).toMatch(/hoje|tarde|14:|15:|16:/i)
      expect(out.interactive?.mode === 'list' || out.interactive?.mode === 'buttons').toBe(true)
    } finally {
      ctx.boot.close()
    }
  })

  it('autodraft após cumprimento — sem repetir resposta quase igual', async () => {
    const ctx = seedClinic()
    try {
      const r1 = await draftReply(ctx, 'Você pode me atender esta tarde?')
      forbidTeamDeferral(r1)
      expect(r1).toMatch(/serviço|Depilação|Massagem|horário|Opções|zonas/i)
      const r2 = await draftReply(ctx, 'Você pode-me atender esta tarde?', false)
      forbidTeamDeferral(r2)
      expect(r2).not.toMatch(/quem confirma/i)
    } finally {
      ctx.boot.close()
    }
  })
})