/**
 * Staging Paulo ~12:20 SP 09/11/2026: after zone eco «Entendi: … Certo?» + Sim,
 * two identical slot offers («Os horários disponíveis…» / próximos) each with
 * Horários list.
 *
 * Same race class as duplicate zone-ask (#640): ingest of `[Botão] Sim` enqueues
 * autodraft; choice handler also realizes Horários. Interactive-reply skip must
 * keep autodraft from re-sending after autoBook already offered slots (DEC-137).
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
import { handleChoiceOfferClick, SLOT_LIST_BUTTON_LABEL } from './choice-offer'
import { enqueueAutoDraft, getAutoDraftJob, runDueAutoDrafts } from './index'

/** qui 05/11/2026 10:00 America/Sao_Paulo — catálogo de diálogo. */
const NOW = Date.UTC(2026, 10, 5, 13, 0)

function seed() {
  const clock = createControllableClock(NOW - 10 * 60_000)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_dup_slot',
      phoneNumberId: 'pn_dup_slot',
      wabaId: 'waba_dup_slot',
      displayPhone: '+5511900000088',
      displayName: 'Clínica Dup Slot',
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
      { name: 'Costas', durationMinutes: 30, priceCents: 7000, audience: 'feminino' },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000088', displayName: 'Paulo Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  clock.advance(60_000)
  return { ...boot, clock, tenantId, caller, cnv, db }
}

async function say(s: ReturnType<typeof seed>, body: string) {
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
  return runDueAutoDrafts(s.db, s.caller, s.clock, {
    mode: 'synthetic',
    adapter: new SimulatedAiAdapter(),
  })
}

function outbound(s: ReturnType<typeof seed>) {
  return s.db.all<{ body: string; kind: string; interactive_json: string | null }>(
    `SELECT m.body AS body, o.kind AS kind, o.interactive_json AS interactive_json
     FROM outbound_messages o
     JOIN messages m ON m.id = o.message_id
     WHERE o.tenant_id = ?
     ORDER BY o.created_at, o.rowid`,
    s.tenantId,
  )
}

function buttonId(json: string | null, title: string): string {
  const parsed = JSON.parse(json ?? '{}') as {
    buttons?: Array<{ id: string; title: string }>
  }
  const button = parsed.buttons?.find((item) => item.title === title)
  expect(button?.id).toBeTruthy()
  return button!.id
}

function slotOffers(rows: ReturnType<typeof outbound>) {
  return rows.filter((m) => (m.interactive_json ?? '').includes(SLOT_LIST_BUTTON_LABEL))
}

async function reachEco(s: ReturnType<typeof seed>) {
  await say(s, 'Quero depilação')
  await say(s, 'feminina')
  await say(s, 'Axila, Pernas e Costas')
  const echo = outbound(s).filter((row) => (row.interactive_json ?? '').includes('Corrigir')).at(-1)
  expect(echo?.body ?? '').toMatch(/Entendi:/)
  return echo!
}

describe('Horários único após Sim do eco (DEC-137)', () => {
  it('texto «Sim» após o eco manda uma oferta com Horários', async () => {
    const s = seed()
    try {
      await reachEco(s)
      const before = outbound(s).length
      await say(s, 'Sim')
      const offers = slotOffers(outbound(s).slice(before))
      expect(offers).toHaveLength(1)
      expect(offers[0]!.body).toMatch(/\d{1,2}:\d{2}/)
    } finally {
      s.close()
    }
  })

  it('produção: ingest [Botão] Sim + toque → uma Horários (job cancelado)', async () => {
    const s = seed()
    try {
      const echo = await reachEco(s)
      const id = buttonId(echo.interactive_json, 'Sim')
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
      const last = s.db.get<{ id: string }>(
        `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
        s.cnv.id,
      )!
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: last.id }, s.clock)
      expect(getAutoDraftJob(s.db, s.tenantId, s.cnv.id)).not.toBeNull()

      const before = outbound(s).length
      const clicked = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: id,
          providerEventKey: 'eco-sim-prod',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      expect(getAutoDraftJob(s.db, s.tenantId, s.cnv.id)).toBeNull()
      s.clock.advance(7_000)
      const outcomes = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(outcomes).toHaveLength(0)
      const offers = slotOffers(outbound(s).slice(before))
      expect(offers).toHaveLength(1)
    } finally {
      s.close()
    }
  })

  it('race: autodraft de [Botão] Sim antes do click não emite Horários; o click emite uma', async () => {
    const s = seed()
    try {
      const echo = await reachEco(s)
      const id = buttonId(echo.interactive_json, 'Sim')
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
      const last = s.db.get<{ id: string }>(
        `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
        s.cnv.id,
      )!
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: last.id }, s.clock)
      const before = outbound(s).length
      s.clock.advance(7_000)
      const outcomes = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(outcomes.some((o) => o.reason === 'interactive_reply_button')).toBe(true)
      expect(slotOffers(outbound(s).slice(before))).toHaveLength(0)

      const clicked = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: id,
          providerEventKey: 'eco-sim-race',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      const offers = slotOffers(outbound(s).slice(before))
      expect(offers).toHaveLength(1)
      expect(offers[0]!.interactive_json ?? '').toContain(SLOT_LIST_BUTTON_LABEL)
    } finally {
      s.close()
    }
  })
})
