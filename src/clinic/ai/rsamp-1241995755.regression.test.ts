/**
 * rsamp_1241995755 (staging): Sim nas zonas não herda 15:30 de marcação anterior;
 * lembra compromisso no dia pedido; oferece horários livres.
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
import { zonedCivilToUtc } from '../scheduling/timezone'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getBookingFrame } from './schedule-session'
import { catalogReply } from './catalog-reply'
import { handleChoiceOfferClick } from './choice-offer'

const TZ = 'America/Sao_Paulo'
/** Domingo 15/11/2026 ~21:57 BRT. */
const NOW = zonedCivilToUtc(TZ, 2026, 11, 15, 21, 57)

const MALE_ZONES = ['Axila', 'Pernas', 'Íntima'].map((name) => ({
  name,
  audience: 'masculino' as const,
  durationMinutes: 30,
  priceCents: 8000,
}))

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-rsamp-1241995755'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_1241995755',
      phoneNumberId: 'pn_1241995755',
      wabaId: 'waba_1241995755',
      displayPhone: '+5511999881777',
      displayName: 'Clínica Demo',
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
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: null,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      variantSelection: 'varias',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
      audiencia: 'masculino',
    },
    clock,
  )
  replaceServiceZonesOp(db, caller, depil.id, MALE_ZONES, clock)
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
    { tenantId, waId: '5511999881777', displayName: 'Cliente' },
    clock,
  )
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const monday1530 = zonedCivilToUtc(TZ, 2026, 11, 16, 15, 30)
  db.run(
    `INSERT INTO appointments (id, tenant_id, service_id, professional_id, starts_at, ends_at, status, created_at, contact_id, confirmed_by)
     VALUES ('apt_synth_mon', ?, ?, ?, ?, ?, 'confirmed', ?, ?, 'system:proposal-send')`,
    tenantId,
    depil.id,
    pro.id,
    monday1530,
    monday1530 + 60 * 60_000,
    NOW - 86_400_000,
    contact.id,
  )
  return { ...boot, clock, tenantId, caller, cnv, depil, contact, pro }
}

type Seed = ReturnType<typeof seed>

async function say(s: Seed, body: string, fromInteractive = false) {
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
  enqueueAutoDraft(
    s.db,
    s.tenantId,
    { conversationId: s.cnv.id, messageId: last.id, fromInteractive },
    s.clock,
  )
  s.clock.advance(fromInteractive ? 500 : 7_000)
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

describe('rsamp_1241995755 — hora inventada, lembrete e domingo', () => {
  it('Sim nas zonas sem hora pedida não cita 15:30; lembra marcação na segunda', async () => {
    const s = seed()
    try {
      await say(s, 'Gostaria de agendar um horário amanhã para depilação masculina')
      await say(s, 'axila, pernas e íntima')
      const sim = (
        JSON.parse(
          s.db.get<{ interactive_json: string | null }>(
            `SELECT interactive_json FROM outbound_messages WHERE tenant_id = ? AND kind = 'interactive' ORDER BY created_at DESC LIMIT 1`,
            s.tenantId,
          )?.interactive_json ?? '{}',
        ) as { buttons?: Array<{ id: string; title: string }> }
      ).buttons?.find((b) => b.title === 'Sim')
      expect(sim?.id).toBeTruthy()
      s.clock.advance(1_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '[Botão] Sim',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const confirmed = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: sim!.id,
          providerEventKey: 'rsamp-1241995755-echo-sim',
        },
        s.clock,
      )
      expect(confirmed.handled).toBe(true)
      const body = lastOutbound(s)
      expect(body).not.toMatch(/Nesse horário das \d{2}:\d{2}/i)
      expect(body).toMatch(/Você já tem/i)
      expect(body).toMatch(/15:30/)
      expect(body).toMatch(/outro horário ou serviço/i)
      expect(body).toMatch(/\d{1,2}:\d{2}/)
      const day = getBookingFrame(s.db, s.tenantId, s.cnv.id)?.date
      expect(day).toBe('2026-11-16')
    } finally {
      s.close()
    }
  }, 90_000)

  it('«atende no domingo» responde expediente sem «Não entendi»', () => {
    const s = seed()
    try {
      const reply = catalogReply(s.db, s.tenantId, 'você atende no domingo?', s.clock, {
        conversationId: s.cnv.id,
      })
      expect(reply).toBeTruthy()
      expect(reply!).not.toMatch(/Não entendi/i)
      expect(reply!).toMatch(/domingo|fechado|funcion/i)
    } finally {
      s.close()
    }
  })
})