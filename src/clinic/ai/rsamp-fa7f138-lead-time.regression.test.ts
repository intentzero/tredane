/**
 * Regressão rsamp_fa7f138 — oferta «hoje às 10:45» com relógio ~10:41 (4 min de antecedência).
 * Com booking_lead_minutes=30 (default), o primeiro slot do dia não pode ser 10:45.
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

const TZ = 'America/Sao_Paulo'
/** qui 12/11/2026 10:41 America/Sao_Paulo */
const NOW = Date.UTC(2026, 10, 12, 13, 41)

function seed() {
  const clock = createControllableClock(NOW - 5 * 60_000)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-fa7f138-lead'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_lead',
      phoneNumberId: 'p_lead',
      wabaId: 'w_lead',
      displayPhone: '+5511900000094',
      displayName: 'C',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Samua', homeRoomId: room.id }, clock)
  const massagem = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 20000,
      variantKind: 'tipo',
      variantKindPlural: 'tipos',
      variantSelection: 'uma',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    massagem.id,
    [
      {
        name: 'Relaxante',
        audience: 'ambos',
        durationMinutes: 60,
        priceCents: 20000,
      },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000094', displayName: 'Cliente' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const say = (direction: 'inbound' | 'outbound', body: string) => {
    clock.advance(60_000)
    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction,
        body,
        deliveryState: direction === 'inbound' ? 'received' : 'delivered',
        createdAt: clock.nowMs(),
      },
      clock,
    )
  }
  return { ...boot, clock, tenantId, caller, cnv, say }
}

describe('rsamp_fa7f138 — antecedência mínima na oferta', () => {
  it('«Relaxante» às 10:41 não oferece 10:45 (default 30 min)', async () => {
    const s = seed()
    try {
      s.say('inbound', 'Quero agendar uma massagem')
      s.say('outbound', 'Para massagem, qual tipo você quer? Temos relaxante.')
      s.clock.advance(60_000)
      s.say('inbound', 'Relaxante')
      const last = s.db.get<{ id: string }>(
        `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
        s.cnv.id,
      )!
      expect(s.clock.nowMs()).toBeGreaterThanOrEqual(NOW - 60_000)
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: last.id }, s.clock)
      s.clock.advance(7_000)
      const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      const reply = out[0]?.autoBook?.replyText ?? ''
      expect(reply).toMatch(/\d{1,2}:\d{2}/)
      expect(reply).not.toMatch(/10:45|10\s*45/)
      expect(reply).toMatch(/13:00|13:30|11:15|11:30/i)
    } finally {
      s.close()
    }
  })
})
