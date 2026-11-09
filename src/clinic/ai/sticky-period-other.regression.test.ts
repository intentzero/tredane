/**
 * Regressão — staging Paulo 09/11/2026 (Deploy c2d2b9a, 18:40–18:42 America/Sao_Paulo):
 * period=noite sticky no BookingFrame após «Quer ver outro período?».
 * «Sim» e «Quero amanhã» repetiam a mesma frase em vez de limpar o período e reofertar.
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
import { getBookingFrame, saveBookingFrame } from './schedule-session'

/** seg 09/11/2026 18:40 America/Sao_Paulo (UTC−3). */
const NOW = Date.UTC(2026, 10, 9, 21, 40)

const EMPTY_NOITE =
  'Para Axila, Pernas, Tórax e Abdômen e Intima, à noite não tenho horário livre. Quer ver outro período?'

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-sticky-period'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_period',
      phoneNumberId: 'p_period',
      wabaId: 'w_period',
      displayPhone: '+5511900000091',
      displayName: 'C',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
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
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const zones = replaceServiceZonesOp(
    db,
    caller,
    depilacao.id,
    [
      { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
      { name: 'Tórax e Abdômen', durationMinutes: 30, priceCents: 10000, audience: 'masculino' },
      { name: 'Intima', durationMinutes: 15, priceCents: 5000, audience: 'feminino' },
    ],
    clock,
  )
  // 09:00–17:00 — sem vagas «à noite» (≥18:00).
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000091', displayName: 'Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const axila = zones.find((z) => z.name === 'Axila' && z.audience === 'feminino')!
  const pernas = zones.find((z) => z.name === 'Pernas' && z.audience === 'feminino')!
  const intima = zones.find((z) => z.name === 'Intima')!
  return { ...boot, clock, tenantId, caller, cnv, depilacao, pro, axila, pernas, intima }
}

function plantStickyNoite(
  s: ReturnType<typeof seed>,
  opts: { date: string; outbound?: string } = { date: '2026-11-10' },
) {
  saveBookingFrame(
    s.db,
    s.tenantId,
    s.cnv.id,
    {
      serviceId: s.depilacao.id,
      line: 'feminino',
      variantIds: [s.axila.id, s.pernas.id, s.intima.id],
      date: opts.date,
      period: 'noite',
      phase: 'coletando',
    },
    s.clock,
  )
  if (opts.outbound !== undefined) {
    insertMessage(
      s.db,
      {
        tenantId: s.tenantId,
        conversationId: s.cnv.id,
        direction: 'outbound',
        body: opts.outbound,
        deliveryState: 'delivered',
        createdAt: s.clock.nowMs(),
      },
      s.clock,
    )
  }
}

async function say(s: ReturnType<typeof seed>, body: string) {
  s.clock.advance(30_000)
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

describe('sticky period=noite — outro período / amanhã (staging 09/11)', () => {
  it('«Sim» após «Quer ver outro período?» limpa period e oferece manhã/tarde', async () => {
    const s = seed()
    try {
      plantStickyNoite(s, { date: '2026-11-10', outbound: EMPTY_NOITE })
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.period).toBe('noite')

      const out = await say(s, 'Sim')
      const reply = out.autoBook?.replyText ?? ''
      expect(reply).not.toMatch(/outro período\?/i)
      expect(reply).not.toMatch(/à noite não tenho/i)
      expect(reply).toMatch(/\d{1,2}:\d{2}/)
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.period).toBeNull()
      expect(frame?.serviceId).toBe(s.depilacao.id)
    } finally {
      s.close()
    }
  })

  it('«Quero amanhã» com period=noite sticky limpa period e oferece o dia novo', async () => {
    const s = seed()
    try {
      // Frame no dia de hoje com noite sticky; «amanhã» muda a data.
      plantStickyNoite(s, {
        date: '2026-11-09',
        outbound: EMPTY_NOITE,
      })

      const out = await say(s, 'Quero amanhã')
      const reply = out.autoBook?.replyText ?? ''
      expect(reply).not.toMatch(/outro período\?/i)
      expect(reply).not.toMatch(/à noite não tenho/i)
      expect(reply).toMatch(/\d{1,2}:\d{2}/)
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.period).toBeNull()
      expect(frame?.date).toBe('2026-11-10')
    } finally {
      s.close()
    }
  })

  it('«Quero agendar amanhã» também limpa noite sticky (smoke Paulo)', async () => {
    const s = seed()
    try {
      plantStickyNoite(s, { date: '2026-11-09', outbound: EMPTY_NOITE })
      const out = await say(s, 'Quero agendar amanhã')
      const reply = out.autoBook?.replyText ?? ''
      expect(reply).not.toMatch(/outro período\?/i)
      expect(reply).toMatch(/\d{1,2}:\d{2}/)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.period).toBeNull()
    } finally {
      s.close()
    }
  })
})
