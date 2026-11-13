/**
 * rsamp_fa7f138db9039e4a63df33e5 (staging 13/11/2026 13:16 BRT, dados fictícios):
 * «Posso falar com um atendente?» na pergunta das zonas virou
 * «Não encontrei falar nas opções» em vez do handoff (DEC-083).
 * Pedido explícito de pessoa em texto livre ganha ao funil em qualquer passo
 * e usa o mesmo handoff do botão «Falar com a equipe» (notifyHumanHandoff).
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { HUMAN_HANDOFF_TEXT } from './human-handoff'

/** Sexta 13/11/2026 13:10 America/Sao_Paulo — dentro do expediente. */
const NOW = Date.UTC(2026, 10, 13, 16, 10)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_handoff_text',
      phoneNumberId: 'pn_handoff_text',
      wabaId: 'waba_handoff_text',
      displayPhone: '+5511900000066',
      displayName: 'Clínica Teste',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: 8000,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    svc.id,
    [
      { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
      { name: 'Axila', durationMinutes: 15, priceCents: 5000, audience: 'masculino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 11000, audience: 'masculino' },
      { name: 'Tórax e Abdômen', durationMinutes: 20, priceCents: 7000, audience: 'masculino' },
      { name: 'Costas', durationMinutes: 20, priceCents: 7000, audience: 'masculino' },
      { name: 'Braços', durationMinutes: 20, priceCents: 7000, audience: 'masculino' },
      { name: 'Intima', durationMinutes: 15, priceCents: 5000, audience: 'masculino' },
      { name: 'Orelha', durationMinutes: 10, priceCents: 3000, audience: 'masculino' },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 9 * 60, endMinute: 18 * 60 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000066', displayName: 'Paulo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv }
}

type Seed = ReturnType<typeof seed>

async function say(s: Seed, body: string) {
  s.clock.advance(60_000)
  insertMessage(
    s.db,
    {
      tenantId: s.tenantId,
      conversationId: s.cnv.id,
      direction: 'inbound',
      body,
      deliveryState: 'received',
      createdAt: s.clock.nowMs(),
    },
    s.clock,
  )
  const last = s.db.get<{ id: string }>(
    `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
    s.cnv.id,
  )!
  enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: last.id }, s.clock)
  s.clock.advance(7_000)
  const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
    mode: 'synthetic',
    adapter: new SimulatedAiAdapter(),
  })
  return out[0]!
}

function lastOutbound(s: Seed): string {
  return (
    s.db.get<{ body: string }>(
      `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound' ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      s.cnv.id,
    )?.body ?? ''
  )
}

function aiPaused(s: Seed): boolean {
  const row = s.db.get<{ ai_reply_paused_at: number | null }>(
    `SELECT ai_reply_paused_at FROM conversations WHERE id = ?`,
    s.cnv.id,
  )
  return row?.ai_reply_paused_at != null
}

/** Passo «zonas»: linha + audiência na mesma frase (como na amostra). */
async function atZoneStep(s: Seed) {
  const r = await say(s, 'Quero agendar uma depilação masculina para a próxima quarta')
  expect(r.autoBook?.replyText ?? lastOutbound(s)).toMatch(/Quais zonas/i)
}

/** Passo «horários»: zonas ecoadas e Sim → lista de horários aberta. */
async function atSlotStep(s: Seed) {
  await say(s, 'Quero agendar uma depilação')
  await say(s, 'Masculina')
  const echo = await say(s, 'Axila e pernas')
  expect(echo.autoBook?.replyText ?? '').toMatch(/^Entendi: axila, pernas\. Certo\?$/)
  const offered = await say(s, 'Sim')
  expect(offered.autoBook?.replyText ?? '').toMatch(/\d{2}:\d{2}/)
}

function expectHandoff(s: Seed, r: Awaited<ReturnType<typeof say>>) {
  expect(r.reason).toBe('human_handoff')
  expect(r.autoBook ?? null).toBeNull()
  const body = lastOutbound(s)
  expect(body.startsWith(HUMAN_HANDOFF_TEXT)).toBe(true)
  expect(body).not.toMatch(/Não encontrei/i)
  expect(aiPaused(s)).toBe(true)
}

const POSITIVE = [
  'Posso falar com um atendente?',
  'quero falar com um atendente',
  'Quero falar com uma pessoa',
  'falar com alguém',
  'me passa pra alguém',
  'HUMANO',
]

describe('rsamp_fa7f138 — pedido de atendente em texto livre aciona o handoff', () => {
  it.each(POSITIVE)('passo zonas: «%s» → handoff, não «Não encontrei … nas opções»', async (text) => {
    const s = seed()
    try {
      await atZoneStep(s)
      const r = await say(s, text)
      expectHandoff(s, r)
    } finally {
      s.close()
    }
  }, 30_000)

  it.each(['Posso falar com um atendente?', 'me passa para um humano'])(
    'passo horários: «%s» → handoff',
    async (text) => {
      const s = seed()
      try {
        await atSlotStep(s)
        const r = await say(s, text)
        expectHandoff(s, r)
      } finally {
        s.close()
      }
    },
    30_000,
  )

  it('passo linha (feminina ou masculina?): «Posso falar com um atendente?» → handoff', async () => {
    const s = seed()
    try {
      const line = await say(s, 'Quero agendar uma depilação')
      expect(line.autoBook?.replyText ?? '').toMatch(/feminina ou masculina/i)
      const r = await say(s, 'Posso falar com um atendente?')
      expectHandoff(s, r)
    } finally {
      s.close()
    }
  }, 30_000)

  it.each(['São duas pessoas', 'É para uma pessoa só'])(
    'passo zonas: «%s» não aciona handoff nem pausa a IA',
    async (text) => {
      const s = seed()
      try {
        await atZoneStep(s)
        const r = await say(s, text)
        expect(r.reason).not.toBe('human_handoff')
        expect(lastOutbound(s).startsWith(HUMAN_HANDOFF_TEXT)).toBe(false)
        expect(aiPaused(s)).toBe(false)
      } finally {
        s.close()
      }
    },
    30_000,
  )
})
