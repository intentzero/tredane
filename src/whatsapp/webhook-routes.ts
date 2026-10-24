/**
 * Rotas públicas de webhook Meta (#32) — sem Clerk.
 * GET  /api/webhooks/whatsapp — challenge
 * POST /api/webhooks/whatsapp — assinatura + ingest
 */
import { Hono } from 'hono'
import { systemClock, type Clock } from '../db/clock'
import type { AdminDb } from '../db/admin/store'
import { createChannelLogger } from '../ops/log'
import type { WorkerBindings } from '../worker/bindings'
import {
  ingestWhatsappWebhook,
  storeFromAdminDb,
  storeFromD1Ops,
} from './webhook-ingest'
import { createD1WebhookOps } from './webhook-d1'
import {
  computeHubSignature256,
  resolveAppSecret,
  resolveVerifyToken,
  verifySubscriptionChallenge,
  type WebhookVerifyEnv,
} from './webhook-verify'
import type { WhatsappWebhookQueueMessage } from './queue-types'

export type WhatsappWebhookRouteOptions = {
  syncAdminDbFactory?: (env: WorkerBindings | undefined) => AdminDb | null
  clockFactory?: () => Clock
  queueFactory?: (
    env: WorkerBindings | undefined,
  ) => { send(message: WhatsappWebhookQueueMessage): Promise<void> }
  logFactory?: (env: WorkerBindings | undefined) => (entry: {
    level: 'info' | 'warn' | 'error'
    event: string
    detail: Record<string, unknown>
  }) => void
}

type AppEnv = {
  Bindings: WorkerBindings
}

function verifyEnv(env: WorkerBindings | undefined): WebhookVerifyEnv {
  return {
    META_MODE: env?.META_MODE ?? 'synthetic',
    META_APP_SECRET: env?.META_APP_SECRET,
    META_VERIFY_TOKEN: env?.META_VERIFY_TOKEN,
  }
}

const defaultLog = createChannelLogger('whatsapp_webhook')

export function createWhatsappWebhookRoutes(opts: WhatsappWebhookRouteOptions = {}) {
  const app = new Hono<AppEnv>()

  app.get('/api/webhooks/whatsapp', (c) => {
    const url = new URL(c.req.url)
    const result = verifySubscriptionChallenge(
      {
        mode: url.searchParams.get('hub.mode'),
        token: url.searchParams.get('hub.verify_token'),
        challenge: url.searchParams.get('hub.challenge'),
      },
      verifyEnv(c.env),
    )
    if (!result.ok) {
      return c.text('forbidden', 403)
    }
    return c.text(result.challenge, 200)
  })

  app.post('/api/webhooks/whatsapp', async (c) => {
    const rawBody = await c.req.text()
    const signature = c.req.header('X-Hub-Signature-256') ?? null
    const clock = opts.clockFactory?.() ?? systemClock
    const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
    if (!syncDb && !c.env?.DB) {
      return c.json({ error: 'admin_unavailable' }, 503)
    }
    const store = syncDb
      ? storeFromAdminDb(syncDb, clock)
      : storeFromD1Ops(createD1WebhookOps(c.env.DB, clock))

    const queue = opts.queueFactory?.(c.env) ?? {
      send: async (message: WhatsappWebhookQueueMessage) => {
        if (!c.env?.INBOUND_EVENTS) throw new Error('queue_unbound')
        await c.env.INBOUND_EVENTS.send(message)
      },
    }

    const result = await ingestWhatsappWebhook(
      {
        store,
        clock,
        queue,
        env: verifyEnv(c.env),
        log: opts.logFactory?.(c.env) ?? defaultLog,
      },
      { rawBody, signatureHeader: signature },
    )

    if (!result.ok) {
      return c.json({ error: result.error }, result.status)
    }
    return c.json(
      {
        ok: true,
        enqueued: result.enqueued,
        duplicates: result.duplicates,
        discarded: result.discarded,
      },
      200,
    )
  })

  /** Synthetic-only: assina e injeta payload de teste (CI). */
  app.post('/api/webhooks/whatsapp/dev/inject', async (c) => {
    const env = verifyEnv(c.env)
    if (env.META_MODE === 'live') {
      return c.json({ error: 'not_available_in_live' }, 404)
    }
    const secret = resolveAppSecret(env)
    if (!secret || !resolveVerifyToken(env)) {
      return c.json({ error: 'webhook_unconfigured' }, 503)
    }
    const body = await c.req.text()
    const signature = await computeHubSignature256(body, secret)
    const clock = opts.clockFactory?.() ?? systemClock
    const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
    if (!syncDb && !c.env?.DB) {
      return c.json({ error: 'admin_unavailable' }, 503)
    }
    const store = syncDb
      ? storeFromAdminDb(syncDb, clock)
      : storeFromD1Ops(createD1WebhookOps(c.env!.DB, clock))
    const queue = opts.queueFactory?.(c.env) ?? {
      send: async (message: WhatsappWebhookQueueMessage) => {
        if (!c.env?.INBOUND_EVENTS) throw new Error('queue_unbound')
        await c.env.INBOUND_EVENTS.send(message)
      },
    }
    const result = await ingestWhatsappWebhook(
      {
        store,
        clock,
        queue,
        env,
        log: opts.logFactory?.(c.env) ?? defaultLog,
      },
      { rawBody: body, signatureHeader: signature },
    )
    if (!result.ok) return c.json({ error: result.error }, result.status)
    return c.json(result, 200)
  })

  return app
}
