/**
 * DEC-221 / staging: etiqueta fechada do classificador → handler; redator de fora.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import {
  INTENT_MIN_CONFIDENCE,
  closedCatalogOrTeamLabel,
  intentLinkPurpose,
  isClosedIntent,
  isIntentLlmEnabled,
  isIntentLlmShadowEnabled,
  isIntentLlmShadowOnly,
  minConfidenceFor,
  shouldClassifyIntent,
} from '../../ai/intent-classifier'
import { upsertKnowledgeCategory, upsertKnowledgeEntry } from '../config/knowledge'
import { createControllableClock } from '../../db/clock'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './autodraft'
import { applyClosedHandlerOp, applyIntentLinkOp } from './llm-apply'
import { getLlmJobByIdempotency, llmJobIdempotencyKey } from './llm-jobs'
import type { LlmQueueEnvelope } from './llm-queue-types'
import type { AiAssistDeps } from './types'
import type { IntentModelResult } from './llm-snapshot'
import { HUMAN_TEAM_OFFER_TEXT } from './human-handoff'
import { replaceServiceZonesOp, upsertResourceOp, upsertServiceOp } from '../config'

const NOW = Date.UTC(2026, 10, 18, 16, 0)

describe('classe de intenção por LLM (DEC-221)', () => {
  it('interruptor por ambiente: só 1, true ou on ligam', () => {
    expect(isIntentLlmEnabled({})).toBe(false)
    expect(isIntentLlmEnabled({ INTENT_LLM_ENABLED: '0' })).toBe(false)
    expect(isIntentLlmEnabled({ INTENT_LLM_ENABLED: '1' })).toBe(true)
    expect(isIntentLlmEnabled({ INTENT_LLM_ENABLED: 'TRUE' })).toBe(true)
    expect(isIntentLlmShadowEnabled({})).toBe(false)
    expect(isIntentLlmShadowEnabled({ INTENT_LLM_SHADOW: 'on' })).toBe(true)
    expect(shouldClassifyIntent({ INTENT_LLM_SHADOW: '1' })).toBe(true)
    expect(shouldClassifyIntent({ INTENT_LLM_ENABLED: '1' })).toBe(true)
    expect(isIntentLlmShadowOnly({ INTENT_LLM_SHADOW: '1' })).toBe(true)
    expect(isIntentLlmShadowOnly({ INTENT_LLM_ENABLED: '1', INTENT_LLM_SHADOW: '1' })).toBe(false)
  })

  it('gate do redator: fechados com confiança ≥ limiar; abertos e baixa confiança não', () => {
    const hi = INTENT_MIN_CONFIDENCE + 0.1
    const lo = INTENT_MIN_CONFIDENCE - 0.01
    expect(minConfidenceFor('faq_clinic')).toBe(INTENT_MIN_CONFIDENCE)
    expect(isClosedIntent({ label: 'agendar', confidence: hi })).toBe(true)
    expect(isClosedIntent({ label: 'price', confidence: hi })).toBe(true)
    expect(isClosedIntent({ label: 'team', confidence: hi })).toBe(true)
    expect(isClosedIntent({ label: 'faq_catalog', confidence: hi })).toBe(true)
    expect(isClosedIntent({ label: 'faq_clinic', confidence: hi })).toBe(true)
    expect(isClosedIntent({ label: 'nenhum', confidence: 0.99 })).toBe(false)
    expect(isClosedIntent({ label: 'price', confidence: lo })).toBe(false)
    expect(isClosedIntent({ label: 'faq_clinic', confidence: lo })).toBe(false)
    expect(intentLinkPurpose({ label: 'agendar', confidence: hi })).toBe('agendar')
    expect(intentLinkPurpose({ label: 'misto', confidence: hi })).toBe('agendar')
    expect(intentLinkPurpose({ label: 'cancelar', confidence: hi })).toBe('cancelar')
    expect(intentLinkPurpose({ label: 'remarcar', confidence: hi })).toBe('remarcar')
    expect(intentLinkPurpose({ label: 'price', confidence: hi })).toBeNull()
    expect(intentLinkPurpose({ label: 'faq_clinic', confidence: hi })).toBeNull()
    expect(intentLinkPurpose({ label: 'nenhum', confidence: 0.99 })).toBeNull()
    expect(closedCatalogOrTeamLabel({ label: 'price', confidence: hi })).toBe('price')
    expect(closedCatalogOrTeamLabel({ label: 'team', confidence: hi })).toBe('team')
    expect(closedCatalogOrTeamLabel({ label: 'faq_catalog', confidence: hi })).toBe('faq_catalog')
    expect(closedCatalogOrTeamLabel({ label: 'faq_clinic', confidence: hi })).toBe('faq_clinic')
    expect(closedCatalogOrTeamLabel({ label: 'agendar', confidence: hi })).toBeNull()
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

  it('cancelar sem marcação futura: frase noUpcoming + cta_url home (DEC-220)', async () => {
    const s = await setup({ classify: true })
    try {
      await applyIntentLinkOp(s.db, s.caller, s.clock, s.deps, {
        jobId: s.job.id,
        idempotencyKey: s.job.idempotencyKey,
        result: { ok: true, text: '', model: 'm', inputTokens: 1, outputTokens: 1, latencyMs: null, intent: intent('cancelar', 0.95) },
      })
      const row = s.db.get<{ body: string; interactive_json: string | null }>(
        `SELECT m.body AS body, o.interactive_json AS interactive_json
         FROM outbound_messages o JOIN messages m ON m.tenant_id = o.tenant_id AND m.id = o.message_id
         WHERE o.tenant_id = ? AND o.client_request_id LIKE 'ai-web-home:%'`,
        s.tenantId,
      )
      expect(row?.body).toMatch(/Não encontrei marcações futuras/)
      expect(row?.interactive_json ?? '').toMatch(/ctaUrl|Abrir agenda/)
    } finally {
      s.close()
    }
  })

  function patchSnapshotQuestion(
    db: ReturnType<typeof bootClinicDb>['db'],
    tenantId: string,
    jobId: string,
    question: string,
  ) {
    const row = db.get<{ snapshot_json: string }>(
      `SELECT snapshot_json FROM llm_jobs WHERE tenant_id = ? AND id = ?`,
      tenantId,
      jobId,
    )
    const snap = JSON.parse(row!.snapshot_json) as Record<string, unknown>
    snap.question = question
    db.run(
      `UPDATE llm_jobs SET snapshot_json = ? WHERE tenant_id = ? AND id = ?`,
      JSON.stringify(snap),
      tenantId,
      jobId,
    )
  }

  it('etiqueta team → oferta de equipe sem pausar e sem Abrir agenda na bolha', async () => {
    // Body do setup cai no redact (sem match de léxico); a etiqueta team decide o handler.
    const s = await setup({ classify: true })
    try {
      patchSnapshotQuestion(s.db, s.tenantId, s.job.id, 'Consegue me passar pra alguém da recepção?')
      const out = await applyClosedHandlerOp(s.db, s.caller, s.clock, s.deps, {
        jobId: s.job.id,
        idempotencyKey: s.job.idempotencyKey,
        result: { ok: true, text: '', model: 'm', inputTokens: 1, outputTokens: 1, latencyMs: null, intent: intent('team', 0.91) },
      })
      expect(out.status).toBe('applied')
      const sent = s.db.all<{ body: string; interactive_json: string | null }>(
        `SELECT m.body AS body, o.interactive_json FROM outbound_messages o
         JOIN messages m ON m.tenant_id = o.tenant_id AND m.id = o.message_id
         WHERE o.tenant_id = ? AND o.client_request_id LIKE 'ai-team-offer:%'`,
        s.tenantId,
      )
      expect(sent).toHaveLength(1)
      expect(sent[0]!.body).toBe(HUMAN_TEAM_OFFER_TEXT)
      expect(sent[0]!.interactive_json ?? '').toMatch(/Falar com a equipe/)
      expect(sent[0]!.interactive_json ?? '').not.toMatch(/Abrir agenda/)
    } finally {
      s.close()
    }
  })

  it('etiqueta price → preço do cadastro + cta_url Abrir agenda home', async () => {
    const s = await setup({ classify: true })
    try {
      const pro = upsertResourceOp(s.db, s.caller, { kind: 'professional', name: 'Ana' }, s.clock)
      upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Limpeza de pele',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 18_000,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      patchSnapshotQuestion(s.db, s.tenantId, s.job.id, 'Quanto custa a limpeza de pele?')
      const out = await applyClosedHandlerOp(s.db, s.caller, s.clock, s.deps, {
        jobId: s.job.id,
        idempotencyKey: s.job.idempotencyKey,
        result: { ok: true, text: '', model: 'm', inputTokens: 1, outputTokens: 1, latencyMs: null, intent: intent('price', 0.88) },
      })
      expect(out.status).toBe('applied')
      const sent = s.db.all<{ body: string; interactive_json: string | null }>(
        `SELECT m.body AS body, o.interactive_json FROM outbound_messages o
         JOIN messages m ON m.tenant_id = o.tenant_id AND m.id = o.message_id
         WHERE o.tenant_id = ? AND (o.client_request_id LIKE 'ai-web-home:%' OR o.client_request_id LIKE 'ai-closed-price:%')`,
        s.tenantId,
      )
      expect(sent.length).toBeGreaterThanOrEqual(1)
      expect(sent[0]!.body).toMatch(/R\$|valor|custa|Limpeza/i)
      expect(sent[0]!.interactive_json ?? '').toMatch(/ctaUrl|Abrir agenda/)
      expect(sent[0]!.interactive_json ?? '').not.toMatch(/Falar com a equipe/)
    } finally {
      s.close()
    }
  })

  it('etiqueta faq_catalog → client_explanation + cta_url home (sem redator)', async () => {
    const s = await setup({ classify: true })
    try {
      const pro = upsertResourceOp(s.db, s.caller, { kind: 'professional', name: 'Gi' }, s.clock)
      const depilacao = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Depilação',
          durationMinutes: 15,
          bufferMinutes: 0,
          priceCents: null,
          variantKind: 'zona',
          variantKindPlural: 'zonas',
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
          clientExplanation: 'Remoção dos pelos pela raiz utilizando cera depilatória.',
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        depilacao.id,
        [
          {
            name: 'Intima',
            audience: 'feminino' as const,
            durationMinutes: 20,
            priceCents: 15_000,
            clientExplanation: 'Inclui virilha e genital no feminino.',
          },
        ],
        s.clock,
      )
      patchSnapshotQuestion(s.db, s.tenantId, s.job.id, 'O que inclui a íntima?')
      const out = await applyClosedHandlerOp(s.db, s.caller, s.clock, s.deps, {
        jobId: s.job.id,
        idempotencyKey: s.job.idempotencyKey,
        result: {
          ok: true,
          text: '',
          model: 'm',
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: null,
          intent: intent('faq_catalog', 0.93),
        },
      })
      expect(out.status).toBe('applied')
      const sent = s.db.all<{ body: string; interactive_json: string | null }>(
        `SELECT m.body AS body, o.interactive_json FROM outbound_messages o
         JOIN messages m ON m.tenant_id = o.tenant_id AND m.id = o.message_id
         WHERE o.tenant_id = ? AND (o.client_request_id LIKE 'ai-web-home:%' OR o.client_request_id LIKE 'ai-closed-faq_catalog:%')`,
        s.tenantId,
      )
      expect(sent).toHaveLength(1)
      expect(sent[0]!.body).toMatch(/Inclui virilha e genital/i)
      expect(sent[0]!.body).not.toMatch(/cera depilatória/i)
      expect(sent[0]!.interactive_json ?? '').toMatch(/ctaUrl|Abrir agenda/)
    } finally {
      s.close()
    }
  })

  it('etiqueta faq_clinic → texto DEC-185 publicado, sem Abrir agenda nem redator', async () => {
    const s = await setup({ classify: true })
    try {
      const cat = upsertKnowledgeCategory(s.db, s.tenantId, { name: 'Acesso' }, s.clock)
      upsertKnowledgeEntry(
        s.db,
        s.tenantId,
        {
          categoryId: cat.id,
          question: 'Tem estacionamento?',
          answer: 'Sim, há vagas na rua em frente à clínica.',
          matchCues: ['estacionamento'],
          status: 'published',
        },
        'owner',
        s.clock,
      )
      patchSnapshotQuestion(s.db, s.tenantId, s.job.id, 'Vocês têm estacionamento perto?')
      const out = await applyClosedHandlerOp(s.db, s.caller, s.clock, s.deps, {
        jobId: s.job.id,
        idempotencyKey: s.job.idempotencyKey,
        result: {
          ok: true,
          text: '',
          model: 'm',
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: null,
          intent: intent('faq_clinic', 0.9),
        },
      })
      expect(out.status).toBe('applied')
      const sent = s.db.all<{ body: string; interactive_json: string | null }>(
        `SELECT m.body AS body, o.interactive_json FROM outbound_messages o
         JOIN messages m ON m.tenant_id = o.tenant_id AND m.id = o.message_id
         WHERE o.tenant_id = ? AND o.client_request_id LIKE 'ai-closed-faq_clinic:%'`,
        s.tenantId,
      )
      expect(sent).toHaveLength(1)
      expect(sent[0]!.body).toMatch(/vagas na rua/i)
      expect(sent[0]!.interactive_json).toBeNull()
    } finally {
      s.close()
    }
  })
})
