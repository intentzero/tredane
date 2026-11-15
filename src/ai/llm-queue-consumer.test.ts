/**
 * DEC-188: após extract apply fino, o consumer retoma autodraft noutro RPC.
 */
import { describe, expect, it, vi } from 'vitest'
import { processLlmJob, type LlmClinicStub } from './llm-queue-consumer'
import type { LlmQueueMessage } from '../clinic/ai/llm-queue-types'
import type { WorkerBindings } from '../worker/bindings'

describe('processLlmJob resume after thin apply', () => {
  it('chama runAutoDrafts com conversationId e limit 1 quando resumeAutodraft', async () => {
    const conversationId = 'cnv_resume_1'
    const msg: LlmQueueMessage = {
      source: 'llm_job',
      tenantId: 'tenant_dec0de000000000000000001',
      jobId: 'llm_1',
      conversationId,
      messageId: 'msg_1',
      purpose: 'extract',
      idempotencyKey: 'ik_1',
    }

    const runAutoDrafts = vi.fn().mockResolvedValue([])
    const stub: LlmClinicStub = {
      claimLlmJob: vi.fn().mockResolvedValue({
        status: 'claimed',
        job: {
          id: 'llm_1',
          purpose: 'extract',
          state: 'claimed',
          snapshotJson: JSON.stringify({
            purpose: 'extract',
            conversationId,
            messageId: 'msg_1',
            turnText: 'fazem pacote pra noivas?',
            today: '2026-11-15',
            frameVersion: 0,
            pending: null,
            catalog: { services: [], variants: [], professionals: [] },
            base: { acts: ['desconhecido'], slots: {}, coverage: 0, needsExtractor: true },
          }),
        },
      }),
      applyLlmResult: vi.fn().mockResolvedValue({
        status: 'applied',
        resumeAutodraft: true,
        conversationId,
      }),
      failLlmJob: vi.fn().mockResolvedValue({ status: 'failed' }),
      runAutoDrafts,
    }

    const env = {
      AI_MODE: 'synthetic',
    } as unknown as WorkerBindings

    const outcome = await processLlmJob(msg, {
      env,
      clinicStub: () => stub,
    })

    expect(outcome).toBe('ack')
    expect(stub.applyLlmResult).toHaveBeenCalledTimes(1)
    expect(runAutoDrafts).toHaveBeenCalledTimes(1)
    expect(runAutoDrafts.mock.calls[0]?.[1]).toEqual({
      conversationId,
      limit: 1,
    })
  })

  it('não chama runAutoDrafts quando apply não pede resume', async () => {
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
})
