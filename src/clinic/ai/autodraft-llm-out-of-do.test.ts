/**
 * DEC-188: com LLM_OUT_OF_DO, autodraft enfileira em vez de chamar o adapter.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter, type AiGenerateInput, type AiGenerateResult } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './autodraft'
import { getLlmJobByIdempotency, llmJobIdempotencyKey } from './llm-jobs'
import type { LlmQueueMessage } from './llm-queue-types'

const NOW = Date.UTC(2026, 10, 15, 16, 0)

class SpyAdapter extends SimulatedAiAdapter {
  calls = 0
  override async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    this.calls += 1
    return super.generate(input)
  }
}

describe('autodraft llm out of DO (DEC-188)', () => {
  it('enfileira redact e não chama adapter.generate', async () => {
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-enqueue'
    const caller = workerCaller(tenantId)
    try {
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

      const adapter = new SpyAdapter()
      const queued: LlmQueueMessage[] = []
      const out = await runDueAutoDrafts(
        db,
        caller,
        clock,
        {
          mode: 'synthetic',
          adapter,
          llmOutOfDo: true,
          enqueueLlmJob: async (m) => {
            queued.push(m)
          },
        },
        { limit: 1 },
      )

      expect(adapter.calls).toBe(0)
      expect(out[0]?.status).toBe('awaiting_llm')
      expect(queued).toHaveLength(1)
      expect(queued[0]?.purpose).toMatch(/extract|redact/)
      const job = getLlmJobByIdempotency(
        db,
        tenantId,
        llmJobIdempotencyKey({
          conversationId: conv.id,
          messageId: msg.id,
          purpose: queued[0]!.purpose,
        }),
      )
      expect(job?.state).toBe('queued')
    } finally {
      close()
    }
  })
})
