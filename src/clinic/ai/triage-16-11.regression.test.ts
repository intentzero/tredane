/**
 * Triagem conversacional 16/11/2026 (staging antes de fe79c1a0).
 * Dados sintéticos: waId 5500…, catálogo depilação (Íntima, Tórax e Abdômen, Costas, Pernas) + Massagem.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { listServices, replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import {
  createProposal,
  evaluateProposalAuthorization,
} from '../proposals/proposals'
import { sendProposalToWhatsAppOp } from '../proposals/send'
import { zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getBookingFrame } from './schedule-session'
import { offerNearestSlots } from './slot-offer'

const TZ = 'America/Sao_Paulo'
/** Terça 18/11/2026 10:00 America/Sao_Paulo */
const NOW = Date.UTC(2026, 10, 18, 13, 0)

const FEM_ZONES = [
  { name: 'Íntima', audience: 'feminino' as const, durationMinutes: 15, priceCents: 5000 },
  { name: 'Tórax e Abdômen', audience: 'feminino' as const, durationMinutes: 15, priceCents: 5000 },
  { name: 'Costas', audience: 'feminino' as const, durationMinutes: 15, priceCents: 5000 },
  { name: 'Pernas', audience: 'feminino' as const, durationMinutes: 30, priceCents: 8000 },
]

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-triage-1611'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_triage_1611',
      phoneNumberId: 'pn_triage',
      wabaId: 'waba_triage',
      displayPhone: '+5511999887700',
      displayName: 'Clínica Sintética',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala A', category: 'Sala' }, clock)
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Pro A', homeRoomId: room.id },
    clock,
  )
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
  replaceServiceZonesOp(db, caller, depil.id, FEM_ZONES, clock)
  const massage = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 12000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({
    dayOfWeek: d,
    startMinute: 9 * 60,
    endMinute: 18 * 60,
  }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '5500998877001', displayName: 'Cliente Sintética' },
    clock,
  )
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const depilLive = listServices(db, tenantId).find((row) => row.id === depil.id)!
  return { ...boot, clock, db, tenantId, caller, contact, cnv, depil: depilLive, massage, pro, room, tz: TZ }
}

type Seed = ReturnType<typeof seed>

async function say(s: Seed, body: string) {
  s.clock.advance(2500)
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
  s.clock.advance(7000)
  const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
    mode: 'synthetic',
    adapter: new SimulatedAiAdapter(),
  })
  return out[0]!
}

describe('triagem 16/11/2026 — P10–P18', () => {
  it('P11: eco preserva ordem «íntima costas e pernas»', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação feminina')
      const out = await say(s, 'íntima costas e pernas')
      const reply = out.autoBook?.replyText ?? ''
      expect(reply).toBe('Entendi: íntima, costas, pernas. Certo?')
    } finally {
      s.close()
    }
  }, 60_000)

  it('P10: «Íntima + Tórax e Abdômen» entra nas duas zonas da proposta', async () => {
    const s = seed()
    try {
      await say(s, 'Depilação feminina terça às 14:00')
      const zones = await say(s, 'Íntima + Tórax e Abdômen')
      expect(zones.autoBook?.replyText ?? '').toMatch(/Íntima|Tórax/i)
      await say(s, 'sim')
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.variantIds?.length).toBe(2)
      const zoneIds = new Set(frame?.variantIds ?? [])
      const intim = s.depil.zones.find((z) => z.name === 'Íntima')
      const torax = s.depil.zones.find((z) => z.name === 'Tórax e Abdômen')
      expect(intim && zoneIds.has(intim.id)).toBe(true)
      expect(torax && zoneIds.has(torax.id)).toBe(true)
    } finally {
      s.close()
    }
  }, 90_000)

  it('P13: não oferece 09:00 quando o contato já tem massagem nesse horário', async () => {
    const s = seed()
    try {
      const day = '2026-11-18'
      const atNine = zonedCivilToUtc(s.tz, 2026, 11, 18, 9, 0)
      s.db.run(
        `INSERT INTO appointments (id, tenant_id, service_id, professional_id, starts_at, ends_at, status, created_at, contact_id, confirmed_by)
         VALUES ('apt_mass_0900', ?, ?, ?, ?, ?, 'confirmed', ?, ?, 'system:proposal-send')`,
        s.tenantId,
        s.massage.id,
        s.pro.id,
        atNine,
        atNine + 60 * 60_000,
        s.clock.nowMs(),
        s.contact.id,
      )
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: s.depil,
        zones: s.depil.zones.filter((z) => z.name === 'Pernas'),
        tz: s.tz,
        clock: s.clock,
        date: day,
        contactId: s.contact.id,
        limit: 5,
        conversationId: s.cnv.id,
      })
      const times = offered.slots.map((slot) => slot.time)
      expect(times).not.toContain('09:00')
      expect(times.length).toBeGreaterThan(0)
    } finally {
      s.close()
    }
  })

  it('P14: proposta «válida» aceita Confirmar antes do webhook Meta', () => {
    const s = seed()
    try {
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'oi',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const startsAt = zonedCivilToUtc(s.tz, 2026, 11, 18, 15, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.depil.id,
          professionalId: s.pro.id,
          startsAt,
          zoneIds: [s.depil.zones[0]!.id],
        },
        s.clock,
      )
      const queued = sendProposalToWhatsAppOp(s.db, s.caller, { proposalId: proposal.id }, s.clock)
      expect(queued.status).toBe('queued')
      s.clock.advance(11_000)
      const auth = evaluateProposalAuthorization(
        s.db,
        {
          tenantId: s.tenantId,
          proposalId: proposal.id,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
        },
        s.clock,
      )
      expect(auth.allowed).toBe(true)
      if (!auth.allowed) return
      expect(auth.proposal.state).toBe('enviada')
      expect(auth.proposal.expiresAt).toBeGreaterThan(s.clock.nowMs())
    } finally {
      s.close()
    }
  })

  it('P18: com zonas no quadro, «terça à tarde» lista horários (não pergunta vazia)', async () => {
    const s = seed()
    try {
      await say(s, 'depilação feminina')
      await say(s, 'Íntima e Costas')
      await say(s, 'sim')
      const terca = await say(s, 'terça à tarde')
      const body = terca.autoBook?.replyText ?? ''
      expect(body).not.toMatch(/^Qual horário fica melhor/i)
      expect(body).toMatch(/\d{1,2}:\d{2}/)
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.period).toBe('tarde')
    } finally {
      s.close()
    }
  }, 60_000)

  it('P18b: «Quero todas» mantém terça pedida (já coberto em #809 — rsamp-3fa91176)', async () => {
    const s = seed()
    try {
      await say(s, 'depilação feminina na terça')
      const day = getBookingFrame(s.db, s.tenantId, s.cnv.id)?.date
      expect(day).toBeTruthy()
      await say(s, 'Quero todas')
      await say(s, 'sim')
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.date).toBe(day)
      const out = await say(s, 'ok')
      const body = out.autoBook?.replyText ?? ''
      expect(body).not.toMatch(/sexta|sábado|domingo/i)
    } finally {
      s.close()
    }
  }, 60_000)
})