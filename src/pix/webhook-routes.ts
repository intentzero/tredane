/**
 * Rotas públicas de webhook Pix/Woovi (#39) — sem Clerk.
 * POST /api/webhooks/pix
 */
import { Hono } from 'hono'
import { systemClock, type Clock } from '../db/clock'
import type { AdminDb } from '../db/admin/store'
import { createChannelLogger } from '../ops/log'
import type { WorkerBindings } from '../worker/bindings'
import {
  ingestPixWebhook,
  storeFromAdminDb,
  storeFromD1Ops,
} from './webhook-ingest'
import { createD1PixWebhookOps } from './webhook-d1'
import type { PixWebhookQueueMessage } from './queue-types'

export type PixWebhookRouteOptions = {
  syncAdminDbFactory?: (env: WorkerBindings | undefined) => AdminDb | null
  clockFactory?: () => Clock
  queueFactory?: (
    env: WorkerBindings | undefined,
  ) => { send(message: PixWebhookQueueMessage): Promise<void> }
  publicKeyPemsFactory?: (env: WorkerBindings | undefined) => string[] | undefined
  fetchImplFactory?: (env: WorkerBindings | undefined) => typeof fetch | undefined
  baseUrlFactory?: (env: WorkerBindings | undefined) => string | undefined
  logFactory?: (env: WorkerBindings | undefined) => (entry: {
    level: 'info' | 'warn' | 'error'
    event: string
    detail: Record<string, unknown>
  }) => void
}

type AppEnv = {
  Bindings: WorkerBindings
}

const defaultLog = createChannelLogger('pix_webhook')

export function createPixWebhookRoutes(opts: PixWebhookRouteOptions = {}) {
  const app = new Hono<AppEnv>()

  app.post('/api/webhooks/pix', async (c) => {
    const rawBody = await c.req.text()
    const clock = opts.clockFactory?.() ?? systemClock
    const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
    if (!syncDb && !c.env?.DB) {
      return c.json({ error: 'admin_unavailable' }, 503)
    }

    const store = syncDb
      ? storeFromAdminDb(syncDb, clock)
      : storeFromD1Ops(createD1PixWebhookOps(c.env!.DB, clock))

    const headers: Record<string, string | undefined> = {
      'x-webhook-signature': c.req.header('x-webhook-signature') ?? undefined,
      'X-Webhook-Signature': c.req.header('X-Webhook-Signature') ?? undefined,
      'x-tredane-pix-signature':
        c.req.header('x-tredane-pix-signature') ?? undefined,
      'content-type': c.req.header('content-type') ?? undefined,
    }

    const queue = opts.queueFactory?.(c.env) ?? {
      send: async (message: PixWebhookQueueMessage) => {
        if (!c.env?.INBOUND_EVENTS) throw new Error('queue_unbound')
        await c.env.INBOUND_EVENTS.send(message)
      },
    }

    const result = await ingestPixWebhook(rawBody, headers, {
      store,
      clock,
      queue,
      env: c.env,
      publicKeyPems: opts.publicKeyPemsFactory?.(c.env),
      fetchImpl: opts.fetchImplFactory?.(c.env),
      baseUrl: opts.baseUrlFactory?.(c.env),
      log: opts.logFactory?.(c.env) ?? defaultLog,
    })

    if (!result.ok) {
      return c.json({ error: result.error }, result.status)
    }
    return c.json(
      {
        ok: true,
        receiptId: result.receiptId,
        duplicate: result.duplicate ?? false,
      },
      200,
    )
  })

  return app
}
