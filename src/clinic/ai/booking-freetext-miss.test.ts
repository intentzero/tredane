/**
 * Texto livre no funil (staging 06/11/2026, dados fictícios).
 * Zona composta não parte no «e». «Sexta às 0900» escolhe 09:00
 * e não reabre a pergunta das zonas. O nome do serviço no meio da
 * frase sai em minúsculas; os rótulos das zonas ficam como no cadastro.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { readZoneSnapshots } from '../config/zones'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { localHHMM } from './slot-offer'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'

/** 06/11/2026 07:30 America/Sao_Paulo — sexta, antes das 09:00. */
const NOW = Date.UTC(2026, 10, 6, 10, 30)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_freetext',
      phoneNumberId: 'pn_freetext',
      wabaId: 'waba_freetext',
      displayPhone: '+5511900000077',
      displayName: 'Clínica Teste',
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
      { name: 'Tórax e Abdômen', durationMinutes: 20, priceCents: 7000, audience: 'masculino' },
      { name: 'Costas', durationMinutes: 20, priceCents: 7000, audience: 'masculino' },
      { name: 'Braços', durationMinutes: 20, priceCents: 7000, audience: 'masculino' },
      { name: 'Intima', durationMinutes: 15, priceCents: 5000, audience: 'masculino' },
      { name: 'Orelha', durationMinutes: 10, priceCents: 3000, audience: 'masculino' },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 9 * 60, endMinute: 18 * 60 }))
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

describe('texto livre: zona composta, 0900 e serviço em prosa', () => {
  it('«tórax e abdômen» fecha com Axila e Pernas; «Sexta às 0900» marca 09:00', async () => {
    const s = seed()
    try {
      const line = await say(s, 'Quero agendar uma depilação')
      const lineText = line.autoBook?.replyText ?? ''
      expect(lineText).toMatch(/feminina ou masculina/i)
      expect(lineText).not.toMatch(/Para Depilação/)

      await say(s, 'Masculina')
      const zones = await say(s, 'Axilas pernas e tórax e abdômen')
      const echo = zones.autoBook?.replyText ?? ''
      expect(echo).toBe('Entendi: Axila, Pernas e Tórax e Abdômen. Certo?')
      expect(echo).not.toMatch(/Não encontrei/i)

      const offered = await say(s, 'Sim')
      const offer = offered.autoBook?.replyText ?? ''
      expect(offer).toMatch(/09:00/)
      expect(offer).not.toMatch(/Não encontrei/i)

      const picked = await say(s, 'Sexta às 0900')
      const reply = picked.autoBook?.replyText ?? ''
      expect(reply).not.toMatch(/Não encontrei/i)
      expect(reply).not.toMatch(/Tórax e Abdômen, Costas/)
      expect(picked.autoBook?.proposalId).toBeTruthy()
      expect(picked.autoBook?.time).toBe('09:00')
      const proposal = s.db.get<{ starts_at: number }>(
        `SELECT starts_at FROM appointment_proposals WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        picked.autoBook?.proposalId ?? '',
      )
      expect(clinicCivilDateFromUtc('America/Sao_Paulo', proposal!.starts_at)).toBe('2026-11-06')
      expect(localHHMM('America/Sao_Paulo', proposal!.starts_at)).toBe('09:00')
      const snaps = readZoneSnapshots(s.db, s.tenantId, 'proposal', picked.autoBook?.proposalId ?? '')
      expect(snaps.map((zone) => zone.name)).toEqual(['Axila', 'Pernas', 'Tórax e Abdômen'])
    } finally {
      s.close()
    }
  }, 30_000)
})
