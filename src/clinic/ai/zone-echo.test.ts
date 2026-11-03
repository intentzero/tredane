/**
 * DEC-137 — eco antes de Horários quando as zonas vêm de texto livre.
 * Plural leve só na linha travada. Sim não marca (DEC-061).
 * Dados fictícios. Relógio local da clínica; a copy não leva fuso.
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
import { handleChoiceOfferClick, SLOT_LIST_BUTTON_LABEL, VARIANT_LIST_BUTTON_LABEL } from './choice-offer'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getScheduleSession } from './schedule-session'

const NOW = Date.UTC(2026, 9, 28, 18, 51)

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
      bindingId: 'bind_echo',
      phoneNumberId: 'pn_echo',
      wabaId: 'waba_echo',
      displayPhone: '+5511900000077',
      displayName: 'Clínica Echo',
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
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000077', displayName: 'Carla Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv }
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
  const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
    mode: 'synthetic',
    adapter: new SimulatedAiAdapter(),
  })
  return out[0]!
}

function outbound(s: ReturnType<typeof seed>) {
  return s.db.all<{ body: string; kind: string; interactive_json: string | null }>(
    `SELECT m.body AS body, o.kind AS kind, o.interactive_json AS interactive_json
     FROM outbound_messages o
     JOIN messages m ON m.id = o.message_id
     WHERE o.tenant_id = ?
     ORDER BY o.created_at`,
    s.tenantId,
  )
}

function appointments(s: ReturnType<typeof seed>): number {
  return s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`, s.tenantId)!.n
}

async function lockFeminine(s: ReturnType<typeof seed>) {
  await say(s, 'Quero depilação')
  await say(s, 'feminina')
}

function buttonId(json: string | null, title: string): string {
  const parsed = JSON.parse(json ?? '{}') as {
    buttons?: Array<{ id: string; title: string }>
  }
  const button = parsed.buttons?.find((item) => item.title === title)
  expect(button?.id).toBeTruthy()
  return button!.id
}

function listRowId(json: string | null, title: string): string {
  const parsed = JSON.parse(json ?? '{}') as {
    list?: { sections?: Array<{ rows?: Array<{ id: string; title: string }> }> }
  }
  const row = parsed.list?.sections?.flatMap((section) => section.rows ?? []).find((item) => item.title === title)
  expect(row?.id).toBeTruthy()
  return row!.id
}

describe('DEC-137: eco e plural das zonas', () => {
  it('«Axilas e pernas» com Feminina → Axila+Pernas femininas, eco, sem Horários', async () => {
    const s = seed()
    try {
      await lockFeminine(s)
      const before = outbound(s).length
      const result = await say(s, 'Axilas e pernas')
      const reply = result.autoBook?.replyText ?? ''
      expect(reply).toBe('Entendi: Axila e Pernas. Certo?')
      expect(result.autoBook?.interactive?.mode).toBe('buttons')
      const after = outbound(s).slice(before)
      const json = after.map((row) => row.interactive_json ?? '').join('\n')
      expect(json).toContain('Sim')
      expect(json).toContain('Corrigir')
      expect(json).not.toContain(SLOT_LIST_BUTTON_LABEL)
      const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
      const rows = s.db.all<{ id: string; name: string; audience: string }>(
        `SELECT id, name, audience FROM service_zones WHERE tenant_id = ?`,
        s.tenantId,
      )
      const chosen = rows.filter((row) => session?.variantIds?.includes(row.id))
      expect(chosen.map((row) => row.name).sort()).toEqual(['Axila', 'Pernas'])
      expect(chosen.every((row) => row.audience === 'feminino')).toBe(true)
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('Sim no eco abre Horários e não cria compromisso', async () => {
    const s = seed()
    try {
      await lockFeminine(s)
      await say(s, 'Axilas e pernas')
      const echo = outbound(s).filter((row) => (row.interactive_json ?? '').includes('Corrigir')).at(-1)
      const id = buttonId(echo?.interactive_json ?? null, 'Sim')
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
      const clicked = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: id,
          providerEventKey: 'echo-sim-zonas',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      if (!clicked.handled) return
      expect(clicked.autoBook?.interactive?.mode).toBe('list')
      if (clicked.autoBook?.interactive?.mode === 'list') {
        expect(clicked.autoBook.interactive.button).toBe(SLOT_LIST_BUTTON_LABEL)
      }
      expect(clicked.autoBook?.replyText ?? '').not.toMatch(/Entendi:/)
      expect(clicked.autoBook?.proposalId).toBeFalsy()
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('sobra sem plural único pergunta a zona e não oferece o parcial', async () => {
    const s = seed()
    try {
      await lockFeminine(s)
      const before = outbound(s).length
      const result = await say(s, 'Axila e cotovelo')
      const reply = result.autoBook?.replyText ?? result.suggestion?.suggestedText ?? ''
      expect(reply).not.toMatch(/Entendi:/)
      expect(reply).not.toMatch(/Horários livres|próximos horários/i)
      const after = outbound(s).slice(before)
      const json = after.map((row) => row.interactive_json ?? '').join('\n')
      expect(json).toContain(VARIANT_LIST_BUTTON_LABEL)
      expect(json).not.toContain(SLOT_LIST_BUTTON_LABEL)
      const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
      expect(session?.variantIds ?? null).toBeNull()
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('toque numa zona da Opções vai a Horários sem eco', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação')
      const line = outbound(s).filter((row) => (row.interactive_json ?? '').includes('Feminina')).at(-1)
      const feminina = buttonId(line?.interactive_json ?? null, 'Feminina')
      s.clock.advance(1_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '[Botão] Feminina',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const lineClick = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: feminina,
          providerEventKey: 'tap-feminina',
        },
        s.clock,
      )
      expect(lineClick.handled).toBe(true)
      const options = outbound(s)
        .filter((row) => (row.interactive_json ?? '').includes(VARIANT_LIST_BUTTON_LABEL))
        .at(-1)
      const id = listRowId(options?.interactive_json ?? null, 'Axila')
      s.clock.advance(1_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '[Lista] Axila',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const clicked = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: id,
          buttonTitle: 'Axila',
          providerEventKey: 'tap-axila',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      if (!clicked.handled) return
      expect(clicked.autoBook?.replyText ?? '').not.toMatch(/Entendi:/)
      expect(clicked.autoBook?.interactive?.mode).toBe('list')
      if (clicked.autoBook?.interactive?.mode === 'list') {
        expect(clicked.autoBook.interactive.button).toBe(SLOT_LIST_BUTTON_LABEL)
      }
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })
})
