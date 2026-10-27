/**
 * Envio imediato (inline) + fila só como fallback, sem duplo envio (2026-10-27).
 */
import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { bootClinicDb } from '../clinic/test-db'
import { createControllableClock } from '../db/clock'
import { clinicInbox, ingestContactMessage, queueCaller, workerCaller } from '../clinic'
import {
  applyOutboundSendResultOp,
  sendOutboundMessageOp,
} from '../clinic/inbox/operations'
import {
  claimOutboundSendOp,
  releaseOutboundSendOp,
  sweepStuckOutboundOp,
  OUTBOUND_CLAIM_STALE_MS,
  OUTBOUND_PENDING_STALE_MS,
} from '../clinic/inbox/dispatch'
import { markOutboxPublished } from '../clinic/outbox'
import { createSyntheticMetaAdapter, SYNTHETIC_CODES, type MetaAdapter } from './meta'
import { handleInboundQueueBatch } from './queue-consumer'
import type { ClinicOutboxQueueMessage } from './queue-types'
import { createWhatsappService } from './service'
import { createMemoryWhatsappChannelSync } from './routes'
import {
  processClinicOutboxMessage,
  SEND_RESULT_TYPE,
  type OutboundSendClinicStub,
} from './outbound-send'
import type { WorkerBindings } from '../worker/bindings'

const T_A = 'clinic-demo-a'
const ATT = 'user_synth_attendant_a'
const OWNER = 'user_synth_owner_a'

const ENV = {
  DB: null as unknown as D1Database,
  CLINIC: null as unknown as WorkerBindings['CLINIC'],
  ATTACHMENTS: null as unknown as R2Bucket,
  INBOUND_EVENTS: null as unknown as Queue,
  META_MODE: 'synthetic',
} as unknown as WorkerBindings

async function setup() {
  const admin = bootAdminDb()
  const clock = createControllableClock(Date.now())
  const clinic = bootClinicDb({ clock })
  const service = createWhatsappService({
    db: admin.db,
    clock,
    metaEnv: { META_MODE: 'synthetic' },
    channelSync: createMemoryWhatsappChannelSync(() => ({ db: clinic.db, clock: clinic.clock })),
  })
  const session = service.startSignupSession({
    tenantId: T_A,
    actorClerkUserId: OWNER,
    purpose: 'connect',
  })
  await service.completeSignup({
    tenantId: T_A,
    actorClerkUserId: OWNER,
    payload: {
      state: session.state,
      code: SYNTHETIC_CODES.valid,
      phoneNumberId: 'pn_inline',
      wabaId: 'waba_inline',
      displayPhone: '+15550007777',
    },
  })
  const caller = workerCaller(T_A, ATT)
  const ing = ingestContactMessage(
    clinic.db,
    caller,
    { providerEventKey: 'wa:inline:1', waId: '5511999000099', body: 'oi' },
    clinic.clock,
  )
  const sent = sendOutboundMessageOp(
    clinic.db,
    caller,
    {
      conversationId: ing.conversation!.id,
      body: 'oi',
      clientRequestId: 'client:inline-1',
      authorClerkUserId: ATT,
      authorDisplayName: 'Ana',
    },
    clinic.clock,
  )
  const row = sent.outbox.find((o) => o.type === 'whatsapp.send')!
  const envelope: ClinicOutboxQueueMessage = {
    source: 'clinic_outbox',
    tenantId: T_A,
    eventId: row.id,
    type: 'whatsapp.send',
    idempotencyKey: row.idempotencyKey,
    occurredAt: row.occurredAt,
    payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
  }
  const metaCalls: string[] = []
  const synth = createSyntheticMetaAdapter()
  const meta: MetaAdapter = {
    ...synth,
    async sendTextMessage(input) {
      metaCalls.push(input.clientRequestId ?? '')
      return synth.sendTextMessage(input)
    },
  }
  let applyFailures = 0
  const stub: OutboundSendClinicStub & { failApply: (n: number) => void } = {
    failApply(n) {
      applyFailures = n
    },
    async applyOutboundSendResult(_c, input) {
      if (applyFailures > 0) {
        applyFailures--
        throw new Error('do_unavailable')
      }
      return applyOutboundSendResultOp(clinic.db, queueCaller(T_A), input, clinic.clock).value
    },
    async claimOutboundSend(c, input) {
      return claimOutboundSendOp(clinic.db, c, input, clinic.clock).value
    },
    async releaseOutboundSend(c, input) {
      return releaseOutboundSendOp(clinic.db, c, input)
    },
  }
  const outbound = () =>
    clinicInbox.findOutboundByClientRequestId(clinic.db, T_A, 'client:inline-1')!
  return {
    admin,
    clinic,
    clock,
    envelope,
    meta,
    metaCalls,
    stub,
    outbound,
    close() {
      clinic.close()
      admin.close()
    },
  }
}

function batchOf(body: ClinicOutboxQueueMessage, acks: string[]) {
  return {
    messages: [
      {
        id: 'm1',
        timestamp: new Date(),
        attempts: 1,
        body,
        ack: () => acks.push('ack'),
        retry: (o?: { delaySeconds?: number }) =>
          acks.push(o?.delaySeconds ? `retry:${o.delaySeconds}` : 'retry'),
      },
    ],
    queue: 'test',
    retryAll() {},
    ackAll() {},
  } as unknown as MessageBatch<ClinicOutboxQueueMessage>
}

describe('envio imediato com fila só como fallback', () => {
  it('inline envia logo (accepted + wamid); fallback da fila não reenvia', async () => {
    const h = await setup()
    try {
      const out = await processClinicOutboxMessage(h.envelope, {
        env: ENV,
        syncAdminDb: h.admin.db,
        metaAdapter: h.meta,
        clinicStub: () => h.stub,
        mode: 'inline',
        sleep: async () => {},
      })
      expect(out).toBe('ack')
      expect(h.outbound().deliveryState).toBe('accepted')
      expect(h.outbound().providerMessageId).toMatch(/^wamid\./)

      const acks: string[] = []
      await handleInboundQueueBatch(batchOf(h.envelope, acks), {
        env: ENV,
        syncAdminDb: h.admin.db,
        metaAdapter: h.meta,
        clinicStub: () => ({
          ingestMessage: async () => ({ duplicate: false }),
          applyWhatsappInterrupt: async () => ({ status: 'interrupted' }),
          recordInboundStatus: async () => ({ duplicate: false, inboundId: 'x', advanced: false }),
          ...h.stub,
        }),
        log: () => {},
      })
      expect(acks).toEqual(['ack'])
      expect(h.metaCalls).toHaveLength(1)
    } finally {
      h.close()
    }
  })

  it('claim em curso: fila adia; claim órfão vira unknown (send_result_lost), nunca reenvia', async () => {
    const h = await setup()
    try {
      const c = queueCaller(T_A)
      const first = claimOutboundSendOp(
        h.clinic.db,
        c,
        { outboxEventId: h.envelope.eventId, idempotencyKey: h.envelope.idempotencyKey },
        h.clinic.clock,
      )
      expect(first.value.status).toBe('claimed')

      const r1 = await processClinicOutboxMessage(h.envelope, {
        env: ENV,
        syncAdminDb: h.admin.db,
        metaAdapter: h.meta,
        clinicStub: () => h.stub,
      })
      expect(r1).toEqual({ retryDelaySeconds: 60 })
      expect(h.metaCalls).toHaveLength(0)

      h.clock.advance(OUTBOUND_CLAIM_STALE_MS + 1)
      const r2 = await processClinicOutboxMessage(h.envelope, {
        env: ENV,
        syncAdminDb: h.admin.db,
        metaAdapter: h.meta,
        clinicStub: () => h.stub,
      })
      expect(r2).toBe('ack')
      expect(h.metaCalls).toHaveLength(0)
      expect(h.outbound().deliveryState).toBe('unknown')
    } finally {
      h.close()
    }
  })

  it('falha a gravar resultado no DO: não descarta — publica whatsapp.send_result e reaplica', async () => {
    const h = await setup()
    try {
      const published: ClinicOutboxQueueMessage[] = []
      h.stub.failApply(3)
      const out = await processClinicOutboxMessage(h.envelope, {
        env: ENV,
        syncAdminDb: h.admin.db,
        metaAdapter: h.meta,
        clinicStub: () => h.stub,
        mode: 'inline',
        sleep: async () => {},
        resultQueue: { send: async (b) => void published.push(b) },
      })
      expect(out).toBe('ack')
      expect(h.metaCalls).toHaveLength(1)
      expect(h.outbound().deliveryState).toBe('pending')
      expect(published).toHaveLength(1)
      expect(published[0].type).toBe(SEND_RESULT_TYPE)
      expect(JSON.stringify(published[0])).not.toMatch(/5511999000099/)

      const again = await processClinicOutboxMessage(published[0], {
        env: ENV,
        metaAdapter: h.meta,
        clinicStub: () => h.stub,
      })
      expect(again).toBe('ack')
      expect(h.outbound().deliveryState).toBe('accepted')
      expect(h.metaCalls).toHaveLength(1)
    } finally {
      h.close()
    }
  })

  it('falha antes da Meta liberta o claim (fila pode enviar uma vez)', async () => {
    const h = await setup()
    try {
      await expect(
        processClinicOutboxMessage(h.envelope, {
          env: ENV,
          // Sem syncAdminDb e DB nulo → falha a resolver credenciais (Meta não chamada).
          metaAdapter: h.meta,
          clinicStub: () => h.stub,
          mode: 'inline',
        }),
      ).rejects.toThrow()
      expect(h.metaCalls).toHaveLength(0)
      const out = await processClinicOutboxMessage(h.envelope, {
        env: ENV,
        syncAdminDb: h.admin.db,
        metaAdapter: h.meta,
        clinicStub: () => h.stub,
      })
      expect(out).toBe('ack')
      expect(h.metaCalls).toHaveLength(1)
      expect(h.outbound().deliveryState).toBe('accepted')
    } finally {
      h.close()
    }
  })

  it('sweep resolve pending publicado sem resultado (caso 13:06) em vez de o deixar preso', async () => {
    const h = await setup()
    try {
      markOutboxPublished(h.clinic.db, T_A, h.envelope.eventId, h.clinic.clock)
      const early = sweepStuckOutboundOp(h.clinic.db, queueCaller(T_A), h.clinic.clock)
      expect(early.resolved).toHaveLength(0)
      expect(early.nextCheckAt).not.toBeNull()
      h.clock.advance(OUTBOUND_PENDING_STALE_MS + 1)
      const swept = sweepStuckOutboundOp(h.clinic.db, queueCaller(T_A), h.clinic.clock)
      expect(swept.resolved).toEqual([h.outbound().id])
      expect(swept.outbox.map((o) => o.type)).toContain('message.delivery_updated')
      expect(h.outbound().deliveryState).toBe('unknown')
    } finally {
      h.close()
    }
  })
})
