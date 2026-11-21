/**
 * DEC-188 / DEC-202: o consumer da fila só trata o redator de exceção (`redact`).
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { processLlmJob, type LlmClinicStub } from './llm-queue-consumer'
import type { LlmQueueMessage } from '../clinic/ai/llm-queue-types'
import type { WorkerBindings } from '../worker/bindings'
import * as intentClassifier from './intent-classifier'

describe('processLlmJob (redator de exceção)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('aplica o resultado do redator e não retoma o autodraft', async () => {
    const conversationId = 'cnv_redact_1'
    const msg: LlmQueueMessage = {
      source: 'llm_job',
      tenantId: 'tenant_dec0de000000000000000001',
      jobId: 'llm_2',
      conversationId,
      messageId: 'msg_2',
      purpose: 'redact',
      idempotencyKey: 'ik_2',
    }

    const runAutoDrafts = vi.fn().mockResolvedValue([])
    const stub: LlmClinicStub = {
      claimLlmJob: vi.fn().mockResolvedValue({
        status: 'claimed',
        job: {
          id: 'llm_2',
          purpose: 'redact',
          state: 'claimed',
          snapshotJson: JSON.stringify({
            purpose: 'redact',
            conversationId,
            messageId: 'msg_2',
            question: 'x',
            frameVersion: 0,
            context: {
              contactFirstName: null,
              stage: null,
              services: [],
              messages: [],
              hasClinicOutbound: false,
              clinicOutboundCount: 0,
            },
          }),
        },
      }),
      applyLlmResult: vi.fn().mockResolvedValue({
        status: 'applied',
        resumeAutodraft: false,
        conversationId,
      }),
      failLlmJob: vi.fn().mockResolvedValue({ status: 'failed' }),
      runAutoDrafts,
    }

    const env = {
      AI_MODE: 'synthetic',
    } as unknown as WorkerBindings

    await processLlmJob(msg, { env, clinicStub: () => stub })
    expect(runAutoDrafts).not.toHaveBeenCalled()
  })

  it('sombra: classifica fechado, loga shadow_would_close e ainda redige (não desvia)', async () => {
    const conversationId = 'cnv_shadow_1'
    const msg: LlmQueueMessage = {
      source: 'llm_job',
      tenantId: 'tenant_dec0de000000000000000001',
      jobId: 'llm_shadow',
      conversationId,
      messageId: 'msg_shadow',
      purpose: 'redact',
      idempotencyKey: 'ik_shadow',
    }
    vi.spyOn(intentClassifier, 'classifyIntentWithLlm').mockResolvedValue({
      result: { label: 'faq_catalog', confidence: 0.95, raw: 'faq_catalog' },
      inputTokens: 10,
      outputTokens: 5,
      model: 'test-model',
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const applyLlmResult = vi.fn().mockResolvedValue({
      status: 'applied',
      resumeAutodraft: false,
      conversationId,
    })
    const stub: LlmClinicStub = {
      claimLlmJob: vi.fn().mockResolvedValue({
        status: 'claimed',
        job: {
          id: 'llm_shadow',
          purpose: 'redact',
          state: 'claimed',
          snapshotJson: JSON.stringify({
            purpose: 'redact',
            conversationId,
            messageId: 'msg_shadow',
            question: 'Fazem depilação íntima?',
            frameVersion: 0,
            classify: true,
            classifyShadow: true,
            context: {
              contactFirstName: null,
              stage: null,
              services: [],
              messages: [],
              hasClinicOutbound: false,
              clinicOutboundCount: 0,
            },
          }),
        },
      }),
      applyLlmResult,
      failLlmJob: vi.fn().mockResolvedValue({ status: 'failed' }),
      runAutoDrafts: vi.fn(),
    }
    await processLlmJob(msg, {
      env: { AI_MODE: 'synthetic' } as unknown as WorkerBindings,
      clinicStub: () => stub,
    })
    const shadowLog = info.mock.calls
      .map((c) => {
        try {
          return JSON.parse(String(c[0]))
        } catch {
          return null
        }
      })
      .find((r) => r?.event === 'ai.intent_llm')
    expect(shadowLog?.mode).toBe('shadow')
    expect(shadowLog?.outcome).toBe('shadow_would_close')
    expect(shadowLog?.label).toBe('faq_catalog')
    expect(applyLlmResult).toHaveBeenCalled()
    const applied = applyLlmResult.mock.calls[0]?.[1] as {
      result: { text: string; intent?: { label: string } | null }
    }
    // Sombra não devolve texto vazio de handler — o redator synthetic ainda corre.
    expect(applied.result.intent?.label).toBe('faq_catalog')
    expect(typeof applied.result.text).toBe('string')
  })
})
