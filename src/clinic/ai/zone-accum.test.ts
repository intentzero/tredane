/**
 * DEC-178 — acumulação multi-zona: Opções → Mais|Pronto (sem eco Entendi a cada toque).
 * Texto livre + eco DEC-137 mantém-se em paralelo.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { ensureClinicSettings, setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import {
  encodeChoiceId,
  handleChoiceOfferClick,
  parseChoiceId,
  SLOT_LIST_BUTTON_LABEL,
  VARIANT_LIST_BUTTON_LABEL,
  ZONE_ACCUM_MAIS_LABEL,
  ZONE_ACCUM_PRONTO_LABEL,
} from './choice-offer'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getBookingFrame, getScheduleSession } from './schedule-session'

const NOW = Date.UTC(2026, 9, 28, 18, 51)

function seed() {
  const clock = createControllableClock(NOW - 10 * 60_000)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-accum'
  ensureClinicSettings(db, tenantId, clock)
  db.run(`UPDATE clinic_settings SET booking_lead_minutes = 0 WHERE id = 1`)
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_accum',
      phoneNumberId: 'pn_accum',
      wabaId: 'waba_accum',
      displayPhone: '+5511900000088',
      displayName: 'Clínica Accum',
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
      { name: 'Buço', durationMinutes: 10, priceCents: 2500, audience: 'ambos' },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000088', displayName: 'Carla Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv, svcId: svc.id }
}

async function say(s: ReturnType<typeof seed>, body: string) {
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
  const outcomes = await runDueAutoDrafts(s.db, s.caller, s.clock, {
    mode: 'synthetic',
    adapter: new SimulatedAiAdapter(),
  })
  return outcomes[0]
}

function outbound(s: ReturnType<typeof seed>) {
  return s.db.all<{ body: string; interactive_json: string | null; kind: string }>(
    `SELECT m.body AS body, o.interactive_json AS interactive_json, o.kind AS kind
     FROM outbound_messages o
     JOIN messages m ON m.id = o.message_id
     WHERE o.tenant_id = ? AND m.conversation_id = ?
     ORDER BY o.created_at`,
    s.tenantId,
    s.cnv.id,
  )
}

function listRowId(interactiveJson: string | null, title: string): string {
  const parsed = JSON.parse(interactiveJson ?? '{}') as {
    list?: { sections?: Array<{ rows?: Array<{ id: string; title: string }> }> }
  }
  const row = parsed.list?.sections?.flatMap((sec) => sec.rows ?? []).find((r) => r.title === title)
  expect(row?.id).toBeTruthy()
  return row!.id
}

function buttonId(interactiveJson: string | null, title: string): string {
  const parsed = JSON.parse(interactiveJson ?? '{}') as {
    buttons?: Array<{ id: string; title: string }>
  }
  const btn = parsed.buttons?.find((b) => b.title === title)
  expect(btn?.id).toBeTruthy()
  return btn!.id
}

async function tap(
  s: ReturnType<typeof seed>,
  buttonIdValue: string,
  label: string,
  key: string,
) {
  s.clock.advance(1_000)
  insertMessage(
    s.db,
    {
      tenantId: s.tenantId,
      conversationId: s.cnv.id,
      direction: 'inbound',
      body: `[Botão] ${label}`,
      deliveryState: 'received',
      createdAt: s.clock.nowMs(),
    },
    s.clock,
  )
  return handleChoiceOfferClick(
    s.db,
    s.caller,
    {
      tenantId: s.tenantId,
      conversationId: s.cnv.id,
      buttonId: buttonIdValue,
      providerEventKey: key,
    },
    s.clock,
  )
}

describe('DEC-178 zone accum Mais|Pronto', () => {
  it('ask zonas em varias traz Opções', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação feminina')
      const ask = outbound(s).at(-1)
      expect(ask?.body).toMatch(/quais zonas/i)
      expect(ask?.body).toMatch(/Toque em Opções/i)
      expect(ask?.interactive_json ?? '').toContain(VARIANT_LIST_BUTTON_LABEL)
      expect(ask?.interactive_json ?? '').not.toContain('Todas')
    } finally {
      s.close()
    }
  })

  it('toque Axila → ack curto + Mais|Pronto (sem Entendi)', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação feminina')
      const ask = outbound(s).at(-1)
      const axilaId = listRowId(ask?.interactive_json ?? null, 'Axila')
      const clicked = await tap(s, axilaId, 'Axila', 'accum-axila')
      expect(clicked.handled).toBe(true)
      if (!clicked.handled) return
      const reply = clicked.autoBook?.replyText ?? ''
      expect(reply).toMatch(/^axila$/i)
      expect(reply).not.toMatch(/Entendi:|Certo\?/)
      expect(clicked.autoBook?.interactive?.mode).toBe('buttons')
      if (clicked.autoBook?.interactive?.mode === 'buttons') {
        expect(clicked.autoBook.interactive.buttons.map((b) => b.title)).toEqual([
          ZONE_ACCUM_MAIS_LABEL,
          ZONE_ACCUM_PRONTO_LABEL,
        ])
      }
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.pending?.slot).toBe('acumular')
      expect(frame?.variantIds?.length).toBe(1)
    } finally {
      s.close()
    }
  })

  it('Mais reabre Opções com «já: axila» e omite Axila', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação feminina')
      const ask = outbound(s).at(-1)
      const axilaId = listRowId(ask?.interactive_json ?? null, 'Axila')
      await tap(s, axilaId, 'Axila', 'accum-axila-2')
      const accum = outbound(s).at(-1)
      const maisId = buttonId(accum?.interactive_json ?? null, ZONE_ACCUM_MAIS_LABEL)
      const clicked = await tap(s, maisId, ZONE_ACCUM_MAIS_LABEL, 'accum-mais')
      expect(clicked.handled).toBe(true)
      if (!clicked.handled) return
      expect(clicked.autoBook?.replyText ?? '').toMatch(/^já: axila$/i)
      expect(clicked.autoBook?.interactive?.mode).toBe('list')
      const json = JSON.stringify(clicked.autoBook?.interactive ?? {})
      expect(json).toContain(VARIANT_LIST_BUTTON_LABEL)
      expect(json).toContain('Pernas')
      expect(json).not.toMatch(/"title":"Axila"/)
    } finally {
      s.close()
    }
  })

  it('Axila → Mais → Pernas → Pronto abre Horários (sem eco Entendi)', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação feminina')
      let last = outbound(s).at(-1)
      await tap(s, listRowId(last?.interactive_json ?? null, 'Axila'), 'Axila', 'a1')
      last = outbound(s).at(-1)
      await tap(s, buttonId(last?.interactive_json ?? null, ZONE_ACCUM_MAIS_LABEL), 'Mais', 'm1')
      last = outbound(s).at(-1)
      await tap(s, listRowId(last?.interactive_json ?? null, 'Pernas'), 'Pernas', 'p1')
      last = outbound(s).at(-1)
      expect(last?.body).toMatch(/axila, pernas/i)
      expect(last?.body).not.toMatch(/Entendi:|Certo\?/)
      const prontoId = buttonId(last?.interactive_json ?? null, ZONE_ACCUM_PRONTO_LABEL)
      const clicked = await tap(s, prontoId, ZONE_ACCUM_PRONTO_LABEL, 'pronto1')
      expect(clicked.handled).toBe(true)
      if (!clicked.handled) return
      const reply = clicked.autoBook?.replyText ?? ''
      expect(reply).toMatch(/\d{1,2}:\d{2}/)
      expect(reply).not.toMatch(/Entendi:/)
      expect(clicked.autoBook?.interactive?.mode).toBe('list')
      if (clicked.autoBook?.interactive?.mode === 'list') {
        expect(clicked.autoBook.interactive.button).toBe(SLOT_LIST_BUTTON_LABEL)
      }
      const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
      const names = s.db
        .all<{ id: string; name: string }>(
          `SELECT id, name FROM service_zones WHERE tenant_id = ?`,
          s.tenantId,
        )
        .filter((z) => session?.variantIds?.includes(z.id))
        .map((z) => z.name)
        .sort()
      expect(names).toEqual(['Axila', 'Pernas'])
    } finally {
      s.close()
    }
  })

  it('texto livre «axila e pernas» ainda ecoa Entendi (DEC-137)', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação feminina')
      const result = await say(s, 'axila e pernas')
      const reply = result?.autoBook?.replyText ?? ''
      expect(reply).toBe('Entendi: axila, pernas. Certo?')
      expect(result?.autoBook?.interactive?.mode).toBe('buttons')
    } finally {
      s.close()
    }
  })

  it('ids opacos de acumular parseiam', () => {
    const built = encodeChoiceId('acumular', 'v1', 'mais')
    expect(parseChoiceId(built)).toEqual({ slot: 'acumular', catalogVersion: 'v1', key: 'mais' })
  })
})
