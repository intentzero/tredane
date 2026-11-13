/**
 * P1 — rsamp_fa7f138db9039e4a63df33e5 (staging 13/11/2026 BRT, dados fictícios):
 *   11:21:28 «Quero agendar uma massagem relaxante para a próxima terça feora»
 *            → «Entendi: relaxante. Não encontrei feora nas opções…» (corrigido em #716)
 *   13:12:26 «A íntima inclui anus?» → «Entendi: intima. Não encontrei inclui…» (corrigido em #722)
 * Este ficheiro fixa as frases exactas no passo «zonas» do catálogo da amostra
 * e cobre as lacunas vizinhas: «fiera» (transposição) e «Pernas é a perna inteira?».
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

/** Passo «zonas»: linha + audiência na mesma frase (como na amostra). */
async function atZoneStep(s: Seed) {
  const r = await say(s, 'Quero agendar uma depilação masculina para a próxima quarta')
  expect(r.autoBook?.replyText ?? lastOutbound(s)).toMatch(/Quais zonas/i)
}


describe('P1 rsamp_fa7f138 — sobra de zona só quando parece zona', () => {
  it('passo zonas: «A íntima inclui anus?» → resposta FAQ, sem «Não encontrei inclui/anus»', async () => {
    const s = seed()
    try {
      await atZoneStep(s)
      await say(s, 'A íntima inclui anus?')
      const body = lastOutbound(s)
      expect(body).not.toMatch(/Não encontrei/i)
      expect(body).toMatch(/Não tenho esse detalhe no cadastro|faz parte de Intima/i)
    } finally {
      s.close()
    }
  }, 30_000)

  it.each(['Pernas é a perna inteira?', 'Braços é o braço todo?'])(
    'passo zonas: «%s» → resposta FAQ, sem «Não encontrei»',
    async (text) => {
      const s = seed()
      try {
        await atZoneStep(s)
        await say(s, text)
        const body = lastOutbound(s)
        expect(body).not.toMatch(/Não encontrei/i)
        expect(body).toMatch(/Não tenho esse detalhe no cadastro/i)
      } finally {
        s.close()
      }
    },
    30_000,
  )

  it.each(['quero na próxima terça feora', 'pode ser quarta fiera'])(
    'passo zonas: dia com typo «%s» não vira «Não encontrei feora/fiera»',
    async (text) => {
      const s = seed()
      try {
        await atZoneStep(s)
        await say(s, text)
        expect(lastOutbound(s)).not.toMatch(/Não encontrei\s+f(eo|ie)ra/i)
      } finally {
        s.close()
      }
    },
    30_000,
  )

  it.each([
    ['Íntima e pernas', /^Entendi: pernas, intima\. Certo\?$/],
    ['pernas e axila?', /^Entendi: axila, pernas\. Certo\?$/],
    ['Orelha', /^Entendi: orelha\. Certo\?$/],
  ] as const)('negativo: zona real «%s» continua a casar', async (text, re) => {
    const s = seed()
    try {
      await atZoneStep(s)
      await say(s, text)
      expect(lastOutbound(s)).toMatch(re)
    } finally {
      s.close()
    }
  }, 30_000)

  it('negativo: zona inexistente «quero cotovelo» continua «Não encontrei cotovelo»', async () => {
    const s = seed()
    try {
      await atZoneStep(s)
      await say(s, 'quero cotovelo')
      expect(lastOutbound(s)).toMatch(/Não encontrei cotovelo nas opções/i)
    } finally {
      s.close()
    }
  }, 30_000)
})
