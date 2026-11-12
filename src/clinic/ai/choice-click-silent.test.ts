/**
 * Anti-silêncio em toques M5 / lista (staging 12/11/2026).
 */
import { describe, expect, it, vi } from 'vitest'
import type { AiGenerateInput, AiGenerateResult } from '../../ai'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import * as autobookMod from './autobook'
import { encodeChoiceId, handleChoiceOfferClick } from './choice-offer'
import {
  CHOICE_CLICK_FALLBACK_TEXT,
  CHOICE_STALE_CLICK_FALLBACK_TEXT,
} from './interactive-click-guard'
import { enqueueAutoDraft, runDueAutoDrafts, AUTODRAFT_ALARM_BUDGET_MS } from './index'
import { saveBookingFrame } from './schedule-session'

const NOW = Date.UTC(2026, 10, 12, 22, 0)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-silent'
  const caller = workerCaller(tenantId, 'user_owner')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_silent',
      phoneNumberId: 'pn_silent',
      wabaId: 'waba_silent',
      displayPhone: '+5511900000999',
      displayName: 'Clínica Guard',
      action: 'channel_connected',
    },
    clock,
  )
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Ana' }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 12000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000999', displayName: 'Cliente' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const outboundBodies = () =>
    db
      .all<{ body: string }>(
        `SELECT m.body AS body
         FROM outbound_messages o
         JOIN messages m ON m.id = o.message_id
         WHERE o.tenant_id = ? AND o.conversation_id = ?
         ORDER BY o.created_at`,
        tenantId,
        cnv.id,
      )
      .map((r) => r.body)
  return { ...boot, clock, tenantId, caller, cnv, svc, outboundBodies }
}

describe('anti-silêncio — toque em lista M5', () => {
  it('resultado vazio do autobook envia fallback', async () => {
    const s = seed()
    const spy = vi.spyOn(autobookMod, 'tryAiAutoBook').mockResolvedValue({
      status: 'not_confirmed',
      missing: ['horario'],
      confirmationMessageId: 'in_1',
      outbox: [],
      replyText: '',
    })
    try {
      const catalogVersion = 'cv1'
      const slotKey = '2026-11-16T10:00'
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          catalogVersion,
          pending: {
            slot: 'horario',
            messageId: 'msg_offer',
            options: [{ key: slotKey, label: 'segunda 16/11 10:00' }],
          },
          phase: 'ofertado',
        },
        s.clock,
      )
      s.db.run(
        `INSERT INTO messages (id, tenant_id, conversation_id, direction, body, delivery_state, created_at)
         VALUES ('msg_offer', ?, ?, 'outbound', 'horários', 'delivered', ?)`,
        s.tenantId,
        s.cnv.id,
        s.clock.nowMs(),
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '[Lista] segunda 16/11 10:00',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const buttonId = encodeChoiceId('horario', catalogVersion, slotKey)
      const result = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId,
          providerEventKey: 'whr_empty_autobook',
        },
        s.clock,
      )
      expect(result.handled).toBe(true)
      if (!result.handled) return
      expect(result.fallbackSent).toBe(true)
      expect(result.outbox.length).toBeGreaterThan(0)
      expect(s.outboundBodies()).toContain(CHOICE_CLICK_FALLBACK_TEXT)
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
      s.close()
    }
  })

  it('oferta stale sem reoferta envia fallback stale', async () => {
    const s = seed()
    const spy = vi.spyOn(autobookMod, 'tryAiAutoBook').mockResolvedValue({
      status: 'not_confirmed',
      missing: [],
      confirmationMessageId: null,
      outbox: [],
      replyText: '',
    })
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          catalogVersion: 'cv_old',
          pending: null,
          phase: 'coletando',
        },
        s.clock,
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '[Lista] stale',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const buttonId = encodeChoiceId('horario', 'cv_other', '2026-11-16T10:00')
      const result = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId,
          providerEventKey: 'whr_stale',
        },
        s.clock,
      )
      expect(result.handled).toBe(true)
      if (!result.handled) return
      expect(result.outcome).toBe('stale_cleared')
      expect(s.outboundBodies()).toContain(CHOICE_STALE_CLICK_FALLBACK_TEXT)
    } finally {
      spy.mockRestore()
      s.close()
    }
  })
})

class SlowAutoDraftAdapter extends SimulatedAiAdapter {
  constructor(private readonly clock: ReturnType<typeof createControllableClock>) {
    super()
  }
  override async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    this.clock.advance(20_000)
    return super.generate(input)
  }
}

describe('runDueAutoDrafts — teto do alarme', () => {
  it(`interrompe após ~${AUTODRAFT_ALARM_BUDGET_MS}ms no mesmo turno`, async () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-alarm'
    const caller = workerCaller(tenantId)
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'bind_budget',
        phoneNumberId: 'pn_budget',
        wabaId: 'waba_budget',
        displayPhone: '+5511900000888',
        displayName: 'Clínica Budget',
        action: 'channel_connected',
      },
      clock,
    )
    const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Lu' }, clock)
    upsertServiceOp(
      db,
      caller,
      {
        name: 'Limpeza',
        durationMinutes: 45,
        bufferMinutes: 0,
        priceCents: 9000,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
  setWeeklyWindowsOp(
      db,
      caller,
      { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }] },
      clock,
    )
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    try {
      const contactIds: string[] = []
      for (let i = 0; i < 5; i++) {
        const contact = upsertContact(
          db,
          { tenantId, waId: `5511900000${100 + i}`, displayName: `C${i}` },
          clock,
        )
        contactIds.push(contact.id)
        const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
        const msg = insertMessage(
          db,
          {
            tenantId,
            conversationId: cnv.id,
            direction: 'inbound',
            body: `oi ${i}`,
            deliveryState: 'received',
            createdAt: clock.nowMs(),
          },
          clock,
        )
        enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: msg.id }, clock)
        clock.advance(1)
      }
      const outcomes = await runDueAutoDrafts(
        db,
        caller,
        clock,
        {
          mode: 'synthetic',
          adapter: new SlowAutoDraftAdapter(clock),
        },
        { limit: 10 },
      )
      expect(outcomes.length).toBeLessThan(5)
      const queued = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ai_autodraft_jobs WHERE tenant_id = ? AND state = 'queued'`,
        tenantId,
      )
      expect(Number(queued?.n ?? 0)).toBeGreaterThan(0)
    } finally {
      boot.close()
    }
  })
})
