/**
 * Webhook processado inline (waitUntil) + cópia atrasada na fila (2026-10-27).
 */
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { bootAdminDb } from '../db/test-db'
import { bootClinicDb } from '../clinic/test-db'
import { createWhatsappService } from './service'
import { createMemoryWhatsappChannelSync } from './routes'
import { SYNTHETIC_CODES } from './meta'
import { computeHubSignature256, SYNTHETIC_APP_SECRET } from './webhook-verify'
import type { WhatsappWebhookQueueMessage } from './queue-types'
import {
  createWhatsappWebhookRoutes,
  INBOUND_INLINE_FALLBACK_DELAY_S,
} from './webhook-routes'
import { handleInboundQueueBatch } from './queue-consumer'
import { markWebhookReceiptProcessed } from './webhook-receipts'
import type { WorkerBindings } from '../worker/bindings'

async function setup() {
  const admin = bootAdminDb()
  const clinic = bootClinicDb()
  const service = createWhatsappService({
    db: admin.db,
    metaEnv: { META_MODE: 'synthetic' },
    channelSync: createMemoryWhatsappChannelSync(() => ({ db: clinic.db, clock: clinic.clock })),
  })
  const session = service.startSignupSession({
    tenantId: 'clinic-demo-a',
    actorClerkUserId: 'user_synth_owner_a',
    purpose: 'connect',
  })
  await service.completeSignup({
    tenantId: 'clinic-demo-a',
    actorClerkUserId: 'user_synth_owner_a',
    payload: {
      state: session.state,
      code: SYNTHETIC_CODES.valid,
      phoneNumberId: 'pnid_inline_wh',
      wabaId: 'waba_inline_wh',
      displayPhone: '+5511988770000',
    },
  })
  return { admin, clinic, close: () => (clinic.close(), admin.close()) }
}

function webhookBody(id: string) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'pnid_inline_wh' },
              contacts: [{ wa_id: '5511912340000', profile: { name: 'Ana' } }],
              messages: [
                {
                  from: '5511912340000',
                  id,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: 'Oi' },
                },
              ],
            },
          },
        ],
      },
    ],
  })
}

describe('webhook WhatsApp inline + fallback atrasado', () => {
  it('processa no próprio pedido e publica cópia atrasada marcada como fallback', async () => {
    const h = await setup()
    try {
      const sent: Array<{ body: WhatsappWebhookQueueMessage; delay?: number }> = []
      const processed: WhatsappWebhookQueueMessage[] = []
      const app = new Hono<{ Bindings: WorkerBindings }>()
      app.route(
        '/',
        createWhatsappWebhookRoutes({
          syncAdminDbFactory: () => h.admin.db,
          inlineProcess: async (_env, m) => {
            processed.push(m)
            return 'ack'
          },
          logFactory: () => () => {},
        }),
      )
      const env = {
        META_MODE: 'synthetic',
        INBOUND_EVENTS: {
          send: async (body: WhatsappWebhookQueueMessage, o?: { delaySeconds?: number }) => {
            sent.push({ body, delay: o?.delaySeconds })
          },
        },
      } as unknown as WorkerBindings
      const pending: Promise<unknown>[] = []
      const ctx = {
        waitUntil: (p: Promise<unknown>) => void pending.push(p),
        passThroughOnException() {},
        props: {},
      } as unknown as ExecutionContext
      const body = webhookBody('wamid.INLINE1')
      const res = await app.fetch(
        new Request('http://localhost/api/webhooks/whatsapp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': await computeHubSignature256(body, SYNTHETIC_APP_SECRET),
          },
          body,
        }),
        env,
        ctx,
      )
      expect(res.status).toBe(200)
      await Promise.all(pending)
      expect(processed).toHaveLength(1)
      expect(processed[0]!.providerEventKey).toBe('wa:msg:wamid.INLINE1')
      expect(sent).toHaveLength(1)
      expect(sent[0]!.delay).toBe(INBOUND_INLINE_FALLBACK_DELAY_S)
      expect(sent[0]!.body.inlineFallback).toBe(true)
    } finally {
      h.close()
    }
  })

  it('consumer ignora fallback cujo recibo já foi processado inline; processa se não', async () => {
    const h = await setup()
    try {
      const { insertWebhookReceipt } = await import('./webhook-receipts')
      const mk = (key: string) =>
        insertWebhookReceipt(h.admin.db, h.clinic.clock, {
          providerEventKey: key,
          tenantId: 'clinic-demo-a',
          kind: 'message',
        }).row
      const done = mk('wa:msg:wamid.DONE')
      const notDone = mk('wa:msg:wamid.NOTDONE')
      markWebhookReceiptProcessed(h.admin.db, done.id, h.clinic.clock, { kind: 'message' })
      const msg = (receiptId: string, key: string): WhatsappWebhookQueueMessage => ({
        source: 'whatsapp_webhook',
        receiptId,
        providerEventKey: key,
        tenantId: 'clinic-demo-a',
        bindingId: 'b',
        phoneNumberId: 'pnid_inline_wh',
        kind: 'message',
        waId: '5511912340000',
        body: 'Oi',
        inlineFallback: true,
      })
      const ingested: string[] = []
      const acks: string[] = []
      const m = (id: string, body: WhatsappWebhookQueueMessage) => ({
        id,
        timestamp: new Date(),
        attempts: 1,
        body,
        ack: () => acks.push(`ack:${id}`),
        retry: () => acks.push(`retry:${id}`),
      })
      await handleInboundQueueBatch(
        {
          messages: [
            m('a', msg(done.id, 'wa:msg:wamid.DONE')),
            m('b', msg(notDone.id, 'wa:msg:wamid.NOTDONE')),
          ],
          queue: 'test',
          retryAll() {},
          ackAll() {},
        } as unknown as MessageBatch<WhatsappWebhookQueueMessage>,
        {
          env: { META_MODE: 'synthetic' } as unknown as WorkerBindings,
          syncAdminDb: h.admin.db,
          clinicStub: () => ({
            ingestMessage: async (_c, input) => {
              ingested.push(input.providerEventKey)
              return { duplicate: false } as never
            },
            applyWhatsappInterrupt: async () => ({ status: 'interrupted' }),
            recordInboundStatus: async () => ({ duplicate: false, inboundId: 'x', advanced: false }),
          }),
          log: () => {},
        },
      )
      expect(ingested).toEqual(['wa:msg:wamid.NOTDONE'])
      expect(acks).toEqual(['ack:a', 'ack:b'])
    } finally {
      h.close()
    }
  })
})
