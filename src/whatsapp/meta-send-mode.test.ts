/**
 * Staging (2026-10-27): META_MODE=live sem META_CONFIG_ID (app não é Tech
 * Provider). Envio e leitura de estado funcionam; Embedded Signup falha fechado.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { bootClinicDb } from '../clinic/test-db'
import { createControllableClock } from '../db/clock'
import {
  clinicInbox,
  ingestContactMessage,
  queueCaller,
  workerCaller,
} from '../clinic'
import {
  applyOutboundSendResultOp,
  sendOutboundMessageOp,
} from '../clinic/inbox/operations'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import { createApp } from '../worker/app'
import {
  createMetaAdapter,
  createMetaSendAdapter,
  resolveMetaMode,
  resolveMetaSendMode,
  SYNTHETIC_CODES,
} from './meta'
import { handleInboundQueueBatch } from './queue-consumer'
import type { ClinicOutboxQueueMessage } from './queue-types'
import { createWhatsappService } from './service'
import { createMemoryWhatsappChannelSync } from './routes'

const LIVE_NO_CONFIG = {
  META_MODE: 'live',
  META_APP_ID: 'app_test_1',
  META_APP_SECRET: 'app_secret_test_value',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveMetaSendMode vs resolveMetaMode', () => {
  it('estrito (Embedded Signup) continua a exigir META_CONFIG_ID', () => {
    expect(() => resolveMetaMode(LIVE_NO_CONFIG)).toThrow('meta_live_missing_credentials')
    expect(() => createMetaAdapter(LIVE_NO_CONFIG)).toThrow('meta_live_missing_credentials')
    expect(resolveMetaMode({ ...LIVE_NO_CONFIG, META_CONFIG_ID: 'cfg' })).toBe('live')
  })

  it('envio aceita live sem META_CONFIG_ID mas exige app id + secret', () => {
    expect(resolveMetaSendMode(LIVE_NO_CONFIG)).toBe('live')
    expect(createMetaSendAdapter(LIVE_NO_CONFIG).mode).toBe('live')
    expect(() =>
      resolveMetaSendMode({ META_MODE: 'live', META_APP_ID: 'a' }),
    ).toThrow('meta_live_missing_credentials')
    expect(() =>
      resolveMetaSendMode({ META_MODE: 'live', META_APP_SECRET: 's' }),
    ).toThrow('meta_live_missing_credentials')
  })

  it('sem META_MODE=live continua synthetic (production inalterada)', () => {
    expect(resolveMetaSendMode({})).toBe('synthetic')
    expect(resolveMetaSendMode({ META_MODE: 'synthetic', ENVIRONMENT: 'production' })).toBe(
      'synthetic',
    )
    expect(createMetaSendAdapter({ META_MODE: 'synthetic' }).mode).toBe('synthetic')
  })

  it('adaptador de envio: Embedded Signup falha fechado sem META_CONFIG_ID (sem chamar a Meta)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const meta = createMetaSendAdapter(LIVE_NO_CONFIG)
    await expect(
      meta.exchangeSignupCode({
        code: 'real_code',
        phoneNumberId: 'pn_1',
        wabaId: 'waba_1',
      }),
    ).rejects.toThrow('meta_live_missing_credentials')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('adaptador de envio: sendTextMessage chama Graph com token + phone_number_id', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid.live_ok' }] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const meta = createMetaSendAdapter(LIVE_NO_CONFIG)
    const res = await meta.sendTextMessage({
      phoneNumberId: 'pn_live_1',
      accessToken: 'tok_live',
      toWaId: '5511999000001',
      body: 'olá',
    })
    expect(res).toEqual({ outcome: 'succeeded', providerMessageId: 'wamid.live_ok' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://graph.facebook.com/v25.0/pn_live_1/messages')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_live')
  })
})

describe('consumer clinic_outbox com META_MODE=live sem META_CONFIG_ID', () => {
  it('envia via Graph (não dead-letter por meta_live_missing_credentials)', async () => {
    const T_A = 'clinic-demo-a'
    const ATT = 'user_synth_attendant_a'
    const OWNER = 'user_synth_owner_a'
    const admin = bootAdminDb()
    const clinic = bootClinicDb()
    const clock = createControllableClock()
    const service = createWhatsappService({
      db: admin.db,
      clock,
      metaEnv: { META_MODE: 'synthetic' },
      channelSync: createMemoryWhatsappChannelSync(() => ({
        db: clinic.db,
        clock: clinic.clock,
      })),
    })
    try {
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
          phoneNumberId: 'pn_live_send',
          wabaId: 'waba_live',
          displayPhone: '+15550008888',
        },
      })
      const caller = workerCaller(T_A, ATT)
      const ing = ingestContactMessage(
        clinic.db,
        caller,
        { providerEventKey: 'wa:live:1', waId: '5511999000007', body: 'oi' },
        clinic.clock,
      )
      const sent = sendOutboundMessageOp(
        clinic.db,
        caller,
        {
          conversationId: ing.conversation!.id,
          body: 'resposta teste',
          clientRequestId: 'client:live-send',
          authorClerkUserId: ATT,
          authorDisplayName: 'Ana',
        },
        clinic.clock,
      )
      const sendOb = sent.outbox.find((o) => o.type === 'whatsapp.send')!
      const envelope: ClinicOutboxQueueMessage = {
        source: 'clinic_outbox',
        tenantId: T_A,
        eventId: sendOb.id,
        type: 'whatsapp.send',
        idempotencyKey: sendOb.idempotencyKey,
        payload: JSON.parse(sendOb.payloadJson) as Record<string, unknown>,
      }

      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ messages: [{ id: 'wamid.live_queue' }] }), {
          status: 200,
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const acks: string[] = []
      await handleInboundQueueBatch(
        {
          messages: [
            {
              id: 'm1',
              timestamp: new Date(),
              attempts: 1,
              body: envelope,
              ack: () => acks.push('ack'),
              retry: () => acks.push('retry'),
            },
          ],
          queue: 'test',
          retryAll() {},
          ackAll() {},
        } as unknown as MessageBatch<ClinicOutboxQueueMessage>,
        {
          env: {
            DB: null as unknown as D1Database,
            CLINIC: null as unknown as import('../worker/bindings').WorkerBindings['CLINIC'],
            ATTACHMENTS: null as unknown as R2Bucket,
            INBOUND_EVENTS: null as unknown as Queue,
            ...LIVE_NO_CONFIG,
          },
          syncAdminDb: admin.db,
          // Sem metaAdapter: exercita createMetaSendAdapter(env).
          clinicStub: () => ({
            ingestMessage: async () => ({ duplicate: false }),
            applyWhatsappInterrupt: async () => ({ status: 'interrupted' }),
            recordInboundStatus: async () => ({
              duplicate: false,
              inboundId: 'x',
              advanced: false,
            }),
            applyOutboundSendResult: async (_c, input) => {
              applyOutboundSendResultOp(clinic.db, queueCaller(T_A), input, clinic.clock)
              return { deliveryState: 'accepted', advanced: true }
            },
          }),
          log: () => {},
        },
      )
      expect(acks).toEqual(['ack'])
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url).toContain('/pn_live_send/messages')
      const ob = clinicInbox.findOutboundByClientRequestId(clinic.db, T_A, 'client:live-send')!
      expect(ob.deliveryState).toBe('accepted')
      expect(ob.providerMessageId).toBe('wamid.live_queue')
    } finally {
      clinic.close()
      admin.close()
    }
  })
})

describe('HTTP /whatsapp com META_MODE=live sem META_CONFIG_ID', () => {
  function harness() {
    const admin = bootAdminDb()
    const services: AuthServices = {
      sessions: createSyntheticSessionAuthenticator({
        authorizedParties: ['http://localhost:5173'],
      }),
      authority: createSyntheticAuthorityReader(),
      adminDb: asyncFromSync(admin.db),
    }
    const app = createApp({
      authServicesFactory: () => services,
      syncAdminDbFactory: () => admin.db,
    })
    const req = (path: string, userId: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', synthAuthHeader(userId))
      return app.request(`http://localhost${path}`, { ...init, headers }, LIVE_NO_CONFIG)
    }
    return { req, close: () => admin.close() }
  }

  it('GET estado responde 200 (leitura); POST session continua fail-closed', async () => {
    const h = harness()
    try {
      const read = await h.req('/api/tenants/clinic-demo-a/whatsapp', 'user_synth_owner_a')
      expect(read.status).toBe(200)
      const body = (await read.json()) as { status: string; metaMode?: string }
      expect(body.status).toBe('disconnected')

      const session = await h.req('/api/tenants/clinic-demo-a/whatsapp/session', 'user_synth_owner_a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'connect' }),
      })
      expect(session.status).toBeGreaterThanOrEqual(400)
    } finally {
      h.close()
    }
  })
})
