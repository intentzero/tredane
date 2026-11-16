/**
 * Regressão lab staging 16/11 (ae6ccd78): handoff em horário de equipe com
 * continuação de agendamento (S03a) e pergunta de catálogo após saúde (S08a).
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import {
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { readReviewFlag } from '../inbox/review-flag'
import { insertMessage } from '../inbox/messages'
import { listOpenPendingCommunicationsForConversation } from '../proposals/pending-communication'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import {
  HANDOFF_PAUSED_ACK_TEXT,
  HEALTH_SAFETY_LINE,
  inboundWarrantsParallelHandoffAutomation,
  readAiReplyPause,
  wantsHumanOnlyEscalation,
} from './human-handoff'

const TEAM_HOURS = Date.UTC(2026, 10, 16, 14, 0)

function seedDepilacao() {
  const clock = createControllableClock(TEAM_HOURS)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-handoff-parallel-s03a'
  const caller = workerCaller(tenantId, 'user_synth_handoff_s03a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_hpar',
      phoneNumberId: 'pn_hpar',
      wabaId: 'waba_hpar',
      displayPhone: '+5511999990103',
      displayName: 'Clínica parallel',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'dep' }, clock)
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Ana', homeRoomId: room.id },
    clock,
  )
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
      variantSelection: 'varias',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
      tempoCeu: 'tanto_faz',
      tempoTemperatura: 'tanto_faz',
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
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1140 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '550000000103', displayName: 'Camila' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const adapter = new SimulatedAiAdapter()
  const say = async (body: string) => {
    const m = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body,
        deliveryState: 'received',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: m.id }, clock)
    clock.advance(7_000)
    return runDueAutoDrafts(db, caller, clock, { mode: 'synthetic', adapter })
  }
  return { db, caller, tenantId, clock, cnv, say, adapter, close: boot.close }
}

function seedSaude() {
  const clock = createControllableClock(TEAM_HOURS)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-handoff-parallel-s08a'
  const caller = workerCaller(tenantId, 'user_synth_handoff_s08a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_s08a',
      phoneNumberId: 'pn_s08a',
      wabaId: 'waba_s08a',
      displayPhone: '+5511999990108',
      displayName: 'Clínica saúde',
      action: 'channel_connected',
    },
    clock,
  )
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Bia' }, clock)
  upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem relaxante',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceCents: 15000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  upsertServiceOp(
    db,
    caller,
    {
      name: 'Drenagem linfática',
      durationMinutes: 50,
      bufferMinutes: 15,
      priceCents: 16000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1140 })),
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '550000000108', displayName: 'Marcia' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const adapter = new SimulatedAiAdapter()
  const say = async (body: string) => {
    const m = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body,
        deliveryState: 'received',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: m.id }, clock)
    clock.advance(7_000)
    return runDueAutoDrafts(db, caller, clock, { mode: 'synthetic', adapter })
  }
  return { db, caller, tenantId, clock, cnv, say, close: boot.close }
}

describe('handoff paralelo em horário de equipe (S03a / S08a)', () => {
  it('S03a: após pedir atendente, zonas seguem o funil com alerta e pausa mantidos', async () => {
    const s = seedDepilacao()
    try {
      await s.say('boa tarde quero fazer depilação')
      await s.say('feminina')
      const handoff = await s.say('quero falar com alguem')
      expect(handoff[0]?.reason).toBe('human_handoff')
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)?.reason).toBe('customer_requested')
      const pending = listOpenPendingCommunicationsForConversation(s.db, s.tenantId, s.cnv.id)
      expect(pending.some((p) => p.kind === 'alter_awaiting_team' && p.status !== 'resolved')).toBe(true)

      const zones = await s.say('ah ta bom entao.. axila e perna')
      expect(zones[0]?.reason).not.toBe('handoff_paused_ack')
      const lastBody = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )?.body
      expect(lastBody).not.toBe(HANDOFF_PAUSED_ACK_TEXT)
      expect(lastBody).toMatch(/Entendi:/i)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)?.reason).toBe('customer_requested')
    } finally {
      s.close()
    }
  })

  it('S08a: após queixa de saúde, responde drenagem/massagem sem silêncio nem ack falso', async () => {
    const s = seedSaude()
    try {
      const first = await s.say('boa tarde to com uma dor nas costas faz 3 dias, o q eu faço?')
      expect(first[0]?.reason).toBe('human_handoff')
      const safetyMsg = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )?.body
      expect(safetyMsg).toContain(HEALTH_SAFETY_LINE)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)?.reason).toBe('off_purpose')

      const second = await s.say('ah ta.. e vcs tem massagem? a drenagem ajuda nisso?')
      expect(second[0]?.reason).not.toBe('handoff_paused_ack')
      const body = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )?.body
      expect(body).not.toBe(HANDOFF_PAUSED_ACK_TEXT)
      expect(body).toMatch(/drenagem|massagem/i)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)?.reason).toBe('off_purpose')
    } finally {
      s.close()
    }
  })

  it('«só quero falar com uma pessoa» após handoff continua no ack, sem retomar funil', async () => {
    const s = seedDepilacao()
    try {
      await s.say('boa tarde quero fazer depilação')
      await s.say('quero falar com alguem')
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)?.reason).toBe('customer_requested')
      expect(wantsHumanOnlyEscalation('só quero falar com uma pessoa')).toBe(true)
      expect(
        inboundWarrantsParallelHandoffAutomation('só quero falar com uma pessoa', 'customer_requested', {
          db: s.db,
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
        }),
      ).toBe(false)

      const insist = await s.say('só quero falar com uma pessoa')
      expect(insist[0]?.reason).toBe('handoff_paused_ack')
      expect(
        s.db.get<{ body: string }>(
          `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
          s.tenantId,
        )?.body,
      ).toBe(HANDOFF_PAUSED_ACK_TEXT)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)?.reason).toBe('customer_requested')
      expect(readReviewFlag(s.db, s.tenantId, s.cnv.id)?.flaggedAt).not.toBeNull()
    } finally {
      s.close()
    }
  })
})

describe('handoff paralelo — detecção', () => {
  it('primeiro pedido de equipe não é «só humano»', () => {
    expect(wantsHumanOnlyEscalation('quero falar com alguem')).toBe(false)
    expect(wantsHumanOnlyEscalation('Quero uma pessoa')).toBe(false)
  })
})