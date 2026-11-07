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

const NOW = Date.UTC(2026, 10, 7, 14, 51) // sáb 07/11 11:51 local

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(db, tenantId, { status: 'connected', bindingId: 'b', phoneNumberId: 'p', wabaId: 'w', displayPhone: '+5511900000099', displayName: 'C', action: 'channel_connected' }, clock)
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
  const svc = upsertServiceOp(db, caller, { name: 'Depilação', durationMinutes: 30, bufferMinutes: 0, priceCents: 8000, variantKind: 'zona', variantKindPlural: 'zonas', professionalIds: [pro.id], roomRequirement: { mode: 'none' } }, clock)
  replaceServiceZonesOp(db, caller, svc.id, [
    { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
    { name: 'Pernas', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
  ], clock)
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000099', displayName: 'Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv }
}
async function say(s: ReturnType<typeof seed>, body: string) {
  s.clock.advance(30_000)
  insertMessage(s.db, { tenantId: s.tenantId, conversationId: s.cnv.id, direction: 'inbound', body, deliveryState: 'received', createdAt: s.clock.nowMs() }, s.clock)
  const last = s.db.get<{ id: string }>(`SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`, s.cnv.id)!
  enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: last.id }, s.clock)
  s.clock.advance(7_000)
  const out = await runDueAutoDrafts(s.db, s.caller, s.clock, { mode: 'synthetic', adapter: new SimulatedAiAdapter() })
  return out[0]!
}
describe('DEC-127: hora solta responde à oferta de horários (sonda segundo telefone, 07/11/2026)', () => {
  it('«13» com 13:00 oferecido liga-se a 13:00 e segue para a proposta', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação feminina de axila e pernas sexta à tarde')
      await say(s, 'sim')
      const offered = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(offered?.pending?.slot).toBe('horario')
      expect(offered?.lastOffer?.slots.length).toBe(3)
      const result = await say(s, '13')
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.time).toBe('13:00')
      expect(frame?.period).toBe('tarde')
      // Não recomeça a oferta pelas primeiras horas da semana.
      expect(result.autoBook?.replyText ?? '').not.toMatch(/09:00/)
    } finally {
      s.close()
    }
  })

  it('hora que não foi oferecida não se liga a nenhuma opção', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação feminina de axila e pernas sexta à tarde')
      await say(s, 'sim')
      await say(s, '17')
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.time).not.toBe('13:00')
    } finally {
      s.close()
    }
  })
})
