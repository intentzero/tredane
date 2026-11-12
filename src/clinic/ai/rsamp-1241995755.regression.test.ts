/**
 * Regressão rsamp_1241995755 (staging 12/11/2026):
 * primeira mensagem com «gostaria de saber», zonas, masculina, hoje à tarde.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { listZones, replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getBookingFrame, getScheduleSession } from './schedule-session'

const TZ = 'America/Sao_Paulo'
/** qui 12/11/2026 10:15 America/Sao_Paulo */
const NOW = Date.UTC(2026, 10, 12, 13, 15)

const INBOUND =
  'Bom dia \nGostaria de saber se tem horário disponível hoje a tarde para depilação masculina, intima e pernas'

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock, timezone: TZ })
  const { db } = boot
  const tenantId = 'clinic-demo-rsamp-1241995755'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_rsamp1',
      phoneNumberId: 'p_rsamp1',
      wabaId: 'w_rsamp1',
      displayPhone: '+5511900000199',
      displayName: 'C',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Pro', homeRoomId: room.id }, clock)
  const depilacao = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: 8000,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      variantSelection: 'varias',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const zoneNames = [
    'Axila',
    'Pernas',
    'Tórax e Abdômen',
    'Costas',
    'Braços',
    'Intima',
    'Orelha',
  ]
  replaceServiceZonesOp(
    db,
    caller,
    depilacao.id,
    zoneNames.map((name) => ({
      name,
      audience: 'masculino' as const,
      durationMinutes: 30,
      priceCents: 8000,
    })),
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000199', displayName: 'Cliente' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv, depilacao }
}

describe('rsamp_1241995755 — primeira mensagem completa', () => {
  it('não ecoa «saber»; grava masculina, zonas, hoje à tarde', async () => {
    const s = seed()
    try {
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: INBOUND,
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
      const reply = out[0]?.autoBook?.replyText ?? ''
      expect(reply).not.toMatch(/Não encontrei saber/i)
      expect(reply).toMatch(/Entendi:.*(intima|íntima).*(pernas)|Entendi:.*(pernas).*(intima|íntima)/i)
      const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(session?.audienceLine ?? frame?.line).toBe('masculino')
      expect(session?.period ?? frame?.period).toBe('tarde')
      // Dia civil «hoje» deve gravar no quadro já no 1.º turno (DEC-137 eco).
      expect(session?.date ?? frame?.date).toBe('2026-11-12')
      const zones = listZones(s.db, s.tenantId, s.depilacao.id).filter((z) =>
        (session?.variantIds ?? frame?.variantIds ?? []).includes(z.id),
      )
      expect(zones.map((z) => z.name.toLowerCase()).sort()).toEqual(['intima', 'pernas'])
    } finally {
      s.close()
    }
  })
})
