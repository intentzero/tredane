/**
 * DEC-135 — após escolha de variantes por texto livre (uma zona ou combinação),
 * o outbound inclui a lista interativa **Horários** (igual ao toque em Opções/Todas).
 * Dados fictícios.
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
import { SLOT_LIST_BUTTON_LABEL } from './choice-offer'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'

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
      bindingId: 'bind_flag',
      phoneNumberId: 'pn_flag',
      wabaId: 'waba_flag',
      displayPhone: '+5511900000077',
      displayName: 'Clínica Flag',
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
      { name: 'Barba', durationMinutes: 15, priceCents: 3000, audience: 'masculino' },
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
  return s.db.all<{ kind: string; interactive_json: string | null }>(
    `SELECT kind, interactive_json FROM outbound_messages WHERE tenant_id = ? ORDER BY created_at`,
    s.tenantId,
  )
}

describe('DEC-135: Horários após texto livre de variantes', () => {
  it('«Axila e pernas» via texto → lista interativa Horários (não só Falar com a equipe)', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação')
      await say(s, 'feminina')
      const before = outbound(s).length
      const result = await say(s, 'Axila e pernas')
      expect(result.reason).not.toBe('catalog_reply')
      expect(result.autoBook?.interactive?.mode).toBe('list')
      if (result.autoBook?.interactive?.mode === 'list') {
        expect(result.autoBook.interactive.button).toBe(SLOT_LIST_BUTTON_LABEL)
      }
      const after = outbound(s).slice(before)
      const interactive = after.filter((m) => m.kind === 'interactive')
      expect(interactive.some((m) => (m.interactive_json ?? '').includes(SLOT_LIST_BUTTON_LABEL))).toBe(
        true,
      )
      expect(interactive.some((m) => (m.interactive_json ?? '').includes('Falar com a equipe'))).toBe(
        false,
      )
    } finally {
      s.close()
    }
  })

  it('uma zona via texto («Axila») também recebe Horários', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação')
      await say(s, 'feminina')
      const before = outbound(s).length
      const result = await say(s, 'Axila')
      expect(result.autoBook?.interactive?.mode).toBe('list')
      if (result.autoBook?.interactive?.mode === 'list') {
        expect(result.autoBook.interactive.button).toBe(SLOT_LIST_BUTTON_LABEL)
      }
      const after = outbound(s).slice(before)
      expect(
        after.some((m) => m.kind === 'interactive' && (m.interactive_json ?? '').includes(SLOT_LIST_BUTTON_LABEL)),
      ).toBe(true)
    } finally {
      s.close()
    }
  })
})
