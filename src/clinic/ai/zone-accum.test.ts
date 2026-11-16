/**
 * DEC-191 — ask de zonas em `varias`: só texto livre + eco DEC-137 (revê DEC-178).
 * Meta lista não permite multi-seleção; sem «Toque em Opções» órfão.
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
  parseChoiceId,
  VARIANT_LIST_BUTTON_LABEL,
} from './choice-offer'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'

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

describe('DEC-191 zone ask varias: texto livre + eco (revê DEC-178)', () => {
  it('ask zonas em varias é só texto (sem Opções)', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação feminina')
      const ask = outbound(s).at(-1)
      expect(ask?.body).toMatch(/quais zonas/i)
      expect(ask?.body).toMatch(/Escreva uma ou várias/i)
      expect(ask?.body).not.toMatch(/Toque em Opções/i)
      expect(ask?.interactive_json ?? '').not.toContain(VARIANT_LIST_BUTTON_LABEL)
    } finally {
      s.close()
    }
  })

  it('texto «axila e pernas» ecoa Entendi com Sim|Corrigir', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação feminina')
      const result = await say(s, 'axila e pernas')
      const reply = result?.autoBook?.replyText ?? ''
      expect(reply).toBe('Entendi: axila, pernas. Certo?')
      expect(result?.autoBook?.interactive?.mode).toBe('buttons')
      const echo = outbound(s).at(-1)
      expect(echo?.interactive_json ?? '').toMatch(/Sim|Corrigir/)
      expect(echo?.interactive_json ?? '').not.toContain(VARIANT_LIST_BUTTON_LABEL)
    } finally {
      s.close()
    }
  })

  it('«todas» ecoa o conjunto (multi por escrita)', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação feminina')
      const result = await say(s, 'todas')
      const reply = result?.autoBook?.replyText ?? ''
      expect(reply).toMatch(/^Entendi: .+\. Certo\?$/)
      expect(reply).toMatch(/axila/i)
      expect(reply).toMatch(/pernas/i)
      expect(result?.autoBook?.interactive?.mode).toBe('buttons')
    } finally {
      s.close()
    }
  })

  it('ids opacos de acumular parseiam (handler legado)', () => {
    const built = encodeChoiceId('acumular', 'v1', 'mais')
    expect(parseChoiceId(built)).toEqual({ slot: 'acumular', catalogVersion: 'v1', key: 'mais' })
  })
})
