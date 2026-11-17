/**
 * DEC-188 / DEC-202: o consumer da fila só trata o redator de exceção (`redact`).
 */
import { describe, expect, it, vi } from 'vitest'
import { processLlmJob, type LlmClinicStub } from './llm-queue-consumer'
import type { LlmQueueMessage } from '../clinic/ai/llm-queue-types'
import type { WorkerBindings } from '../worker/bindings'

describe('processLlmJob (redator de exceção)', () => {
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
})
