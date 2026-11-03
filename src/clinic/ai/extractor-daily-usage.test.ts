/**
 * #491 / M6b-3 — teto diário e ai.turn_decided contam chamadas do extrator.
 * Dados fictícios; sem corpo de mensagem no registo de uso.
 */
import { describe, expect, it } from 'vitest'
import {
  SimulatedAiAdapter,
  type AiGenerateInput,
  type AiGenerateResult,
} from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../envelopes'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './autodraft'
import { getAiDailyUsage, incrementAiDailyUsage, recordModelCallTowardDailyCap } from './usage'
import type { TurnDecidedPayload } from './turn-decided'

const NOW = Date.UTC(2026, 10, 5, 15, 0)
/** Texto coloquial → needsExtractor (sem léxico de serviço). */
const COLLOQUIAL = 'fazem pacote pra noivas no final do ano?'

/**
 * Extrator devolve serviço do catálogo → autobook responde em determinístico
 * (sem redator de exceção). Conta só a chamada do extrator.
 */
class ExtractFillsServiceAdapter extends SimulatedAiAdapter {
  extractCalls = 0
  exceptionCalls = 0

  override async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    if (input.profile === 'extract' || (input.tools && input.tools.length > 0)) {
      this.extractCalls += 1
      const catalog =
        input.userContentOverride?.match(/<<<DADOS catálogo[\s\S]*?DADOS>>>/i)?.[0] ?? ''
      const m = catalog.match(/^- (svc_[a-z0-9]+):/im)
      const text = JSON.stringify({
        acts: ['marcar'],
        serviceId: m?.[1] ?? '_none',
        confidence: 0.4,
      })
      return {
        ok: true,
        text,
        provider: this.providerId,
        model: 'test-extract',
        latencyMs: 8,
        inputTokens: 40,
        outputTokens: 12,
        toolName: input.tools?.[0]?.name ?? 'extract_turn_slots',
      }
    }
    if (input.profile === 'exception') {
      this.exceptionCalls += 1
    }
    return super.generate(input)
  }
}

/** Extrator falha em preencher → redator de exceção também corre. */
class ExtractThenExceptionAdapter extends SimulatedAiAdapter {
  extractCalls = 0
  exceptionCalls = 0

  override async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    if (input.profile === 'extract' || (input.tools && input.tools.length > 0)) {
      this.extractCalls += 1
      return {
        ok: true,
        text: JSON.stringify({ acts: ['desconhecido'], confidence: 0 }),
        provider: this.providerId,
        model: 'test-extract',
        latencyMs: 5,
        inputTokens: 30,
        outputTokens: 8,
        toolName: input.tools?.[0]?.name ?? 'extract_turn_slots',
      }
    }
    if (input.profile === 'exception') {
      this.exceptionCalls += 1
    }
    return super.generate(input)
  }
}

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
      bindingId: 'bind_491',
      phoneNumberId: 'pn_491',
      wabaId: 'waba_491',
      displayPhone: '+5511900000491',
      displayName: 'Clínica Uso',
      action: 'channel_connected',
    },
    clock,
  )
  const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
  upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 50,
      bufferMinutes: 0,
      priceCents: 15000,
      professionalIds: [gi.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: gi.id,
      windows: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 })),
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511900000491', displayName: 'Carla Ficticia' },
    clock,
  )
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { db, caller, tenantId, clock, cnv, contact, close: boot.close }
}

function turnDecidedRows(db: ReturnType<typeof bootClinicDb>['db'], tenantId: string) {
  return db.all<{ payload: string }>(
    `SELECT payload_json AS payload FROM outbox_events
     WHERE tenant_id = ? AND type = 'ai.turn_decided' ORDER BY occurred_at`,
    tenantId,
  )
}

describe('#491 getAiDailyUsage / extrator no teto diário', () => {
  it('getAiDailyUsage conta unidades em drafts (não tokens)', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-a'
    try {
      setClinicAiAssistEnabled(boot.db, tenantId, true, clock)
      expect(getAiDailyUsage(boot.db, tenantId, clock)).toMatchObject({
        drafts: 0,
        capReached: false,
      })
      incrementAiDailyUsage(boot.db, tenantId, clock)
      incrementAiDailyUsage(boot.db, tenantId, clock)
      const u = getAiDailyUsage(boot.db, tenantId, clock)
      expect(u.drafts).toBe(2)
      // Sem coluna de tokens — só o contador drafts.
      const row = boot.db.get<Record<string, unknown>>(
        `SELECT * FROM ai_daily_usage WHERE tenant_id = ?`,
        tenantId,
      )
      expect(row).toBeTruthy()
      expect(Object.keys(row!).sort()).toEqual(
        expect.arrayContaining(['tenant_id', 'day', 'drafts', 'cap_reached_at']),
      )
      expect(row).not.toHaveProperty('tokens')
      expect(row).not.toHaveProperty('input_tokens')
    } finally {
      boot.close()
    }
  })

  it('N turnos só com extrator (sem redator) → teto e turn_decided com N chamadas', async () => {
    const s = seed()
    const adapter = new ExtractFillsServiceAdapter()
    const N = 3
    try {
      for (let i = 0; i < N; i++) {
        // Nova conversa por turno: frame limpo; extrator volta a ser necessário.
        const cnv =
          i === 0
            ? s.cnv
            : createConversation(
                s.db,
                { tenantId: s.tenantId, contactId: s.contact.id, status: 'open' },
                s.clock,
              )
        const msg = insertMessage(
          s.db,
          {
            tenantId: s.tenantId,
            conversationId: cnv.id,
            direction: 'inbound',
            body: COLLOQUIAL,
            deliveryState: 'received',
            createdAt: s.clock.nowMs(),
          },
          s.clock,
        )
        enqueueAutoDraft(
          s.db,
          s.tenantId,
          { conversationId: cnv.id, messageId: msg.id },
          s.clock,
        )
        s.clock.advance(7_000)
        await runDueAutoDrafts(s.db, s.caller, s.clock, { mode: 'synthetic', adapter })
        s.clock.advance(1_000)
      }

      expect(adapter.extractCalls).toBe(N)
      expect(adapter.exceptionCalls).toBe(0)

      const usage = getAiDailyUsage(s.db, s.tenantId, s.clock)
      expect(usage.drafts).toBe(N)

      const rows = turnDecidedRows(s.db, s.tenantId)
      expect(rows.length).toBe(N)
      let calls = 0
      for (const row of rows) {
        const payload = JSON.parse(row.payload) as TurnDecidedPayload
        expect(payload.modelCalled).toBe(true)
        expect(payload.modelCalls).toBe(1)
        expect(row.payload).not.toContain(COLLOQUIAL)
        expect(row.payload).not.toMatch(/"body"\s*:/)
        expect(row.payload).not.toMatch(/"suggestedText"\s*:/)
        calls += payload.modelCalls
      }
      expect(calls).toBe(N)
    } finally {
      s.close()
    }
  })

  it('extrator + redator no mesmo turno → 2 no teto e modelCalls=2', async () => {
    const s = seed()
    const adapter = new ExtractThenExceptionAdapter()
    try {
      const msg = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: COLLOQUIAL,
          deliveryState: 'received',
        },
        s.clock,
      )
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, messageId: msg.id },
        s.clock,
      )
      s.clock.advance(7_000)
      await runDueAutoDrafts(s.db, s.caller, s.clock, { mode: 'synthetic', adapter })

      expect(adapter.extractCalls).toBe(1)
      expect(adapter.exceptionCalls).toBe(1)
      expect(getAiDailyUsage(s.db, s.tenantId, s.clock).drafts).toBe(2)

      const rows = turnDecidedRows(s.db, s.tenantId)
      expect(rows).toHaveLength(1)
      const payload = JSON.parse(rows[0]!.payload) as TurnDecidedPayload
      expect(payload.modelCalled).toBe(true)
      expect(payload.modelCalls).toBe(2)
      expect(rows[0]!.payload).not.toContain(COLLOQUIAL)
    } finally {
      s.close()
    }
  })

  it('recordModelCallTowardDailyCap não grava texto de conversa', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-a'
    try {
      setClinicAiAssistEnabled(boot.db, tenantId, true, clock)
      recordModelCallTowardDailyCap(boot.db, tenantId, clock)
      const row = boot.db.get<{ drafts: number }>(
        `SELECT drafts FROM ai_daily_usage WHERE tenant_id = ?`,
        tenantId,
      )
      expect(row?.drafts).toBe(1)
      const audit = boot.db.all<{ detail: string }>(
        `SELECT detail_json AS detail FROM operational_audit WHERE tenant_id = ?`,
        tenantId,
      )
      for (const a of audit) {
        expect(a.detail).not.toMatch(/mensagem|body|suggestedText/i)
      }
    } finally {
      boot.close()
    }
  })
})
