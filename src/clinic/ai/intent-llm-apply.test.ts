/**
 * P4 (Proposto, só staging): a classe de intenção vinda do LLM desvia um turno para o link.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { INTENT_MIN_CONFIDENCE, intentLinkPurpose, isIntentLlmEnabled } from '../../ai/intent-classifier'
import { createControllableClock } from '../../db/clock'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './autodraft'
import { applyIntentLinkOp } from './llm-apply'
import { getLlmJobByIdempotency, llmJobIdempotencyKey } from './llm-jobs'
import type { LlmQueueEnvelope } from './llm-queue-types'
import type { AiAssistDeps } from './types'
import type { IntentModelResult } from './llm-snapshot'

const NOW = Date.UTC(2026, 10, 18, 16, 0)

describe('classe de intenção por LLM (P4)', () => {
  it('interruptor por ambiente: só 1, true ou on ligam', () => {
    expect(isIntentLlmEnabled({})).toBe(false)
    expect(isIntentLlmEnabled({ INTENT_LLM_ENABLED: '0' })).toBe(false)
    expect(isIntentLlmEnabled({ INTENT_LLM_ENABLED: '1' })).toBe(true)
    expect(isIntentLlmEnabled({ INTENT_LLM_ENABLED: 'TRUE' })).toBe(true)
  })

  it('só agenda com confiança suficiente desvia; informação e outro seguem o redator', () => {
    const hi = INTENT_MIN_CONFIDENCE + 0.1
    expect(intentLinkPurpose({ label: 'agendar', confidence: hi })).toBe('agendar')
    expect(intentLinkPurpose({ label: 'misto', confidence: hi })).toBe('agendar')
    expect(intentLinkPurpose({ label: 'cancelar', confidence: hi })).toBe('cancelar')
    expect(intentLinkPurpose({ label: 'remarcar', confidence: hi })).toBe('remarcar')
    expect(intentLinkPurpose({ label: 'nenhum', confidence: 0.99 })).toBeNull()
    expect(intentLinkPurpose({ label: 'agendar', confidence: INTENT_MIN_CONFIDENCE - 0.01 })).toBeNull()
    expect(intentLinkPurpose(null)).toBeNull()
  })

  async function setup(opts: { classify: boolean; paused?: boolean }) {
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-intent'
    const caller = workerCaller(tenantId)
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b',
        phoneNumberId: 'p',
        wabaId: 'w',
        displayPhone: '+5511900000001',
        displayName: 'Demo',
        action: 'channel_connected',
      },
      clock,
    )
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(db, { tenantId, waId: '5511900000001', displayName: 'Bia' }, clock)
    const conv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    const msg = insertMessage(
      db,
      {
        tenantId,
        conversationId: conv.id,
        direction: 'inbound',
        body: 'Aceitam pacote para noivas no final do ano?',
        deliveryState: 'received',
      },
      clock,
    )
    enqueueAutoDraft(db, tenantId, { conversationId: conv.id, messageId: msg.id }, clock)
    db.run(
      `UPDATE ai_autodraft_jobs SET due_at = ? WHERE tenant_id = ? AND conversation_id = ?`,
      clock.nowMs(),
      tenantId,
      conv.id,
    )
    const queued: LlmQueueEnvelope[] = []
    const deps: AiAssistDeps = {
      mode: 'synthetic',
      adapter: new SimulatedAiAdapter(),
      llmOutOfDo: true,
      intentLlmEnabled: opts.classify,
      autoBookPaused: opts.paused === true,
      enqueueLlmJob: async (m) => {
        queued.push(m)
      },
      prepareClientWebOffer: async () => ({
        buttons: [],
        ctaUrl: { displayText: 'Abrir agenda', url: 'https://staging.example.com/c/cw1_AAAAAAAAAAAAAAAAAAAAAAAA' },
      }) as never,
    }
    await runDueAutoDrafts(db, caller, clock, deps, { limit: 1 })
    const job = getLlmJobByIdempotency(
      db,
      tenantId,
      llmJobIdempotencyKey({ conversationId: conv.id, messageId: msg.id, purpose: 'redact' }),
    )!
    return { db, close, clock, caller, deps, job, tenantId, convId: conv.id }
  }

  const intent = (label: IntentModelResult['label'], confidence: number): IntentModelResult => ({
    label,
    raw: label,
    confidence,
    model: 'm',
    inputTokens: 1,
    outputTokens: 1,
  })

  it('com o interruptor ligado, o snapshot pede a classe ao Worker', async () => {
    const s = await setup({ classify: true })
    try {
      expect(JSON.parse(s.job.snapshotJson).classify).toBe(true)
    } finally {
      s.close()
    }
    const off = await setup({ classify: false })
    try {
      expect(JSON.parse(off.job.snapshotJson).classify).toBeUndefined()
    } finally {
      off.close()
    }
  })

  it('classe de agenda envia o link com a frase fixa e regista a origem LLM', async () => {
    const s = await setup({ classify: true })
    try {
      const out = await applyIntentLinkOp(s.db, s.caller, s.clock, s.deps, {
        jobId: s.job.id,
        idempotencyKey: s.job.idempotencyKey,
        result: { ok: true, text: '', model: 'm', inputTokens: 1, outputTokens: 1, latencyMs: null, intent: intent('agendar', 0.92) },
      })
      expect(out.status).toBe('applied')
      const sent = s.db.all<{ body: string; interactive_json: string | null }>(
        `SELECT m.body AS body, o.interactive_json FROM outbound_messages o
         JOIN messages m ON m.tenant_id = o.tenant_id AND m.id = o.message_id
         WHERE o.tenant_id = ? AND o.client_request_id LIKE 'ai-web-%'`,
        s.tenantId,
      )
      expect(sent).toHaveLength(1)
      expect(sent[0]!.body).toMatch(/Abrir agenda/)
      expect(sent[0]!.interactive_json).toMatch(/ctaUrl/)
    } finally {
      s.close()
    }
  })

  it('com a pausa da owner passa à equipe, sem link', async () => {
    const s = await setup({ classify: true, paused: true })
    try {
      const out = await applyIntentLinkOp(s.db, s.caller, s.clock, s.deps, {
        jobId: s.job.id,
        idempotencyKey: s.job.idempotencyKey,
        result: { ok: true, text: '', model: 'm', inputTokens: 1, outputTokens: 1, latencyMs: null, intent: intent('agendar', 0.92) },
      })
      expect(out.reason).toBe('human_handoff')
      const links = s.db.all<{ n: number }>(
        `SELECT COUNT(*) AS n FROM outbound_messages WHERE tenant_id = ? AND interactive_json LIKE '%ctaUrl%'`,
        s.tenantId,
      )
      expect(links[0]!.n).toBe(0)
    } finally {
      s.close()
    }
  })

  it('cancelar sem marcação futura abre em agendar (mesma regra do léxico)', async () => {
    const s = await setup({ classify: true })
    try {
      await applyIntentLinkOp(s.db, s.caller, s.clock, s.deps, {
        jobId: s.job.id,
        idempotencyKey: s.job.idempotencyKey,
        result: { ok: true, text: '', model: 'm', inputTokens: 1, outputTokens: 1, latencyMs: null, intent: intent('cancelar', 0.95) },
      })
      const row = s.db.get<{ body: string }>(
        `SELECT m.body AS body FROM outbound_messages o JOIN messages m ON m.tenant_id = o.tenant_id AND m.id = o.message_id
         WHERE o.tenant_id = ? AND o.client_request_id LIKE 'ai-web-agendar:%'`,
        s.tenantId,
      )
      expect(row?.body).toMatch(/Não encontrei marcações futuras/)
    } finally {
      s.close()
    }
  })
})
