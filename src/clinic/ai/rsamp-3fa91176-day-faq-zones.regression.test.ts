/**
 * rsamp_fa7f138 / cnv_3fa91176 (staging 15/11/2026 ~18:59 BRT):
 * «depilação masculina na terça» → FAQ de zona/preço → «Quero todas»
 * não deve inventar «09:00» nem perder a terça pedida.
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
import { getBookingFrame } from './schedule-session'

/** Sábado 15/11/2026 18:59 America/Sao_Paulo. */
const NOW = Date.UTC(2026, 10, 15, 21, 59)

const MALE_ZONES = [
  'Axila',
  'Pernas',
  'Tórax e Abdômen',
  'Costas',
  'Braços',
  'Intima',
  'Orelha',
].map((name) => ({
  name,
  audience: 'masculino' as const,
  durationMinutes: 15,
  priceCents: 5000,
}))

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-rsamp-3fa91176'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_3fa91176',
      phoneNumberId: 'pn_3fa91176',
      wabaId: 'waba_3fa91176',
      displayPhone: '+5511999993776',
      displayName: 'Clínica Teste Paulo',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
  const depil = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 30,
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
  replaceServiceZonesOp(db, caller, depil.id, MALE_ZONES, clock)
  const week = [1, 2, 3, 4, 5].map((d) => ({
    dayOfWeek: d,
    startMinute: 9 * 60,
    endMinute: 12 * 60,
  }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511999993776', displayName: 'Cliente' },
    clock,
  )
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv, depil }
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

describe('rsamp_3fa91176 — dia pedido sobrevive a FAQ + todas as zonas', () => {
  it('terça pedida persiste; «Quero todas» oferece horários na terça sem inventar 09:00', async () => {
    const s = seed()
    try {
      await say(s, 'depilação masculina na próxima terça')
      const frameAfterDay = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      const requestedDay = frameAfterDay?.date
      expect(requestedDay).toBeTruthy()

      await say(s, 'a depilação íntima inclui tudo?')
      const frameAfterFaq = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frameAfterFaq?.date).toBe(requestedDay)

      await say(s, 'Quero todas')
      await say(s, 'sim')
      const body = lastOutbound(s)
      expect(body).not.toMatch(/Nesse horário das \d{2}:\d{2}/i)
      expect(body).toMatch(/horários disponíveis|tenho/i)
      expect(body).toMatch(/\d{1,2}:\d{2}/)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.date).toBe(requestedDay)
    } finally {
      s.close()
    }
  }, 60_000)

  it('14/11 «depilação para a próxima terça» sem hora oferece slots (não sem_horario vazio)', async () => {
    const s = seed()
    try {
      s.clock.set(NOW)
      await say(s, 'depilação para a próxima terça')
      await say(s, 'masculina')
      const day = getBookingFrame(s.db, s.tenantId, s.cnv.id)?.date
      expect(day).toBeTruthy()
      await say(s, 'Quero todas')
      await say(s, 'sim')
      const body = lastOutbound(s)
      expect(body).not.toMatch(/Nesse horário das \d{2}:\d{2}/i)
      expect(body).toMatch(/horários disponíveis|tenho/i)
      expect(body).toMatch(/\d{1,2}:\d{2}/)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.date).toBe(day)
    } finally {
      s.close()
    }
  }, 60_000)
})