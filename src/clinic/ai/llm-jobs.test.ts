/**
 * DEC-188 — claim/apply/fail e stale do job LLM.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { applyLlmResultOp, claimLlmJobForTenant, failLlmJobOp } from './llm-apply'
import { createLlmJob, getLlmJob } from './llm-jobs'
import { MODEL_FALLBACK_TEXT } from './model-fallback'
import { SimulatedAiAdapter } from '../../ai'
import { setClinicAiAssistEnabled } from '../config/settings'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { upsertContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { enqueueAutoDraft } from './autodraft'

const NOW = Date.UTC(2026, 10, 15, 15, 0)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-llm'
  const caller = workerCaller(tenantId, 'user_synth_owner')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_llm',
      phoneNumberId: 'pn_llm',
      wabaId: 'waba_llm',
      displayPhone: '+5511900000099',
      displayName: 'Clínica LLM',
      action: 'channel_connected',
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511999990001', displayName: 'Ana' },
    clock,
  )
  const conv = createConversation(db, { tenantId, contactId: contact.id }, clock)
  const msg = insertMessage(
    db,
    {
      tenantId,
      conversationId: conv.id,
      direction: 'inbound',
      body: 'Vocês abrem domingo?',
      deliveryState: 'received',
    },
    clock,
  )
  enqueueAutoDraft(db, tenantId, { conversationId: conv.id, messageId: msg.id }, clock)
  return { db, clock, close: boot.close, tenantId, caller, conv, msg }
}

describe('llm_jobs claim/apply/fail (DEC-188)', () => {
  it('claim → apply redact ok envia texto; segundo claim vê done', async () => {
    const { db, clock, close, tenantId, caller, conv, msg } = seed()
    try {
      const created = createLlmJob(
        db,
        tenantId,
        {
          conversationId: conv.id,
          messageId: msg.id,
          purpose: 'redact',
          frameVersion: 0,
          snapshot: {
            purpose: 'redact',
            conversationId: conv.id,
            messageId: msg.id,
            question: 'Vocês abrem domingo?',
            frameVersion: 0,
            context: {
              contactFirstName: 'Ana',
              stage: null,
              services: [],
              messages: [],
              hasClinicOutbound: false,
              clinicOutboundCount: 0,
              clinic: {
                name: 'Clínica LLM',
                googleBusinessUrl: null,
                reschedulePolicy: '',
                cancelPolicy: '',
                timezone: 'America/Sao_Paulo',
                localNowIso: '2026-11-15T12:00:00-03:00',
                hoursSummary: 'Seg–Sáb 9–18',
                tempoPhrase: null,
                virtualAttendantName: 'Lia',
                virtualAttendantGender: 'feminino',
              },
            },
          },
        },
        clock,
      )
      const claim = claimLlmJobForTenant(
        db,
        tenantId,
        { jobId: created.job.id, idempotencyKey: created.job.idempotencyKey },
        clock,
      )
      expect(claim.status).toBe('claimed')

      const deps = {
        mode: 'synthetic' as const,
        adapter: new SimulatedAiAdapter(),
      }
      const applied = applyLlmResultOp(db, caller, clock, deps, {
        jobId: created.job.id,
        idempotencyKey: created.job.idempotencyKey,
        result: {
          ok: true,
          text: JSON.stringify({
            mensagem: 'Abrimos de segunda a sábado, das 9 às 18. Domingo estamos fechados.',
            notas: '',
          }),
          model: 'test',
          inputTokens: 10,
          outputTokens: 20,
          latencyMs: 5,
        },
      })
      expect(applied.status).toBe('applied')
      expect(applied.outbox.some((o) => o.type === 'whatsapp.send')).toBe(true)

      const again = claimLlmJobForTenant(
        db,
        tenantId,
        { jobId: created.job.id, idempotencyKey: created.job.idempotencyKey },
        clock,
      )
      expect(again.status).toBe('done')
    } finally {
      close()
    }
  })

  it('apply stale (mensagem supersedida) não envia texto antigo', () => {
    const { db, clock, close, tenantId, caller, conv, msg } = seed()
    try {
      const created = createLlmJob(
        db,
        tenantId,
        {
          conversationId: conv.id,
          messageId: msg.id,
          purpose: 'redact',
          frameVersion: 0,
          snapshot: {
            purpose: 'redact',
            conversationId: conv.id,
            messageId: msg.id,
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
          },
        },
        clock,
      )
      // Nova mensagem → autodraft muda messageId
      const msg2 = insertMessage(
        db,
        {
          tenantId,
          conversationId: conv.id,
          direction: 'inbound',
          body: 'outra',
          deliveryState: 'received',
        },
        clock,
      )
      enqueueAutoDraft(db, tenantId, { conversationId: conv.id, messageId: msg2.id }, clock)

      claimLlmJobForTenant(
        db,
        tenantId,
        { jobId: created.job.id, idempotencyKey: created.job.idempotencyKey },
        clock,
      )
      const applied = applyLlmResultOp(
        db,
        caller,
        clock,
        { mode: 'synthetic', adapter: new SimulatedAiAdapter() },
        {
          jobId: created.job.id,
          idempotencyKey: created.job.idempotencyKey,
          result: {
            ok: true,
            text: JSON.stringify({ mensagem: 'texto antigo', notas: '' }),
            model: 'test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
          },
        },
      )
      expect(applied.status).toBe('stale')
      expect(applied.outbox).toEqual([])
      expect(getLlmJob(db, tenantId, created.job.id)?.errorCode).toBe('stale_message')
    } finally {
      close()
    }
  })

  it('failLlmJob envia frase DEC-107 e não pausa', () => {
    const { db, clock, close, tenantId, caller, conv, msg } = seed()
    try {
      const created = createLlmJob(
        db,
        tenantId,
        {
          conversationId: conv.id,
          messageId: msg.id,
          purpose: 'redact',
          frameVersion: 0,
          snapshot: {
            purpose: 'redact',
            conversationId: conv.id,
            messageId: msg.id,
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
          },
        },
        clock,
      )
      claimLlmJobForTenant(
        db,
        tenantId,
        { jobId: created.job.id, idempotencyKey: created.job.idempotencyKey },
        clock,
      )
      const failed = failLlmJobOp(db, caller, clock, {
        jobId: created.job.id,
        idempotencyKey: created.job.idempotencyKey,
        errorCode: 'lab_llm_timeout',
      })
      expect(failed.status).toBe('failed')
      const outbound = db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC LIMIT 1`,
        tenantId,
        conv.id,
      )
      expect(outbound?.body).toBe(MODEL_FALLBACK_TEXT)
    } finally {
      close()
    }
  })
})
