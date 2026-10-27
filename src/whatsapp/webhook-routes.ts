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
  isMetaWebhookDisabled,
  resolveAppSecret,
  resolveVerifyToken,
  verifySubscriptionChallenge,
  type WebhookVerifyEnv,
} from './webhook-verify'
import type { WhatsappWebhookQueueMessage } from './queue-types'
import { processWhatsappMessage } from './queue-consumer'

/** Atraso da cópia de fallback na fila quando o webhook é processado inline. */
export const INBOUND_INLINE_FALLBACK_DELAY_S = 15

function executionWaitUntil(c: {
  executionCtx: { waitUntil(p: Promise<unknown>): void }
}): ((p: Promise<unknown>) => void) | null {
  try {
    const ctx = c.executionCtx
    return (p) => ctx.waitUntil(p)
  } catch {
    return null
  }
}

async function defaultInlineProcess(
  env: WorkerBindings,
  message: WhatsappWebhookQueueMessage,
): Promise<'ack' | 'retry'> {
  return processWhatsappMessage({ env }, message, 1)
}

export type WhatsappWebhookRouteOptions = {
  /** Testes: substitui o processamento inline (DO). */
  inlineProcess?: (
    env: WorkerBindings,
    message: WhatsappWebhookQueueMessage,
  ) => Promise<'ack' | 'retry'>
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
    ENVIRONMENT: env?.ENVIRONMENT,
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
    if (isMetaWebhookDisabled(verifyEnv(c.env))) {
      return c.json({ error: 'webhook_unconfigured' }, 503)
    }
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

    // Processamento inline (no próprio pedido, via waitUntil) + cópia atrasada na
    // fila como fallback. Só quando há ExecutionContext e a fila não é injetada.
    const waitUntil = opts.queueFactory ? null : executionWaitUntil(c)
    const inline: WhatsappWebhookQueueMessage[] = []
    const queue = opts.queueFactory?.(c.env) ?? {
      send: async (message: WhatsappWebhookQueueMessage) => {
        if (!c.env?.INBOUND_EVENTS) throw new Error('queue_unbound')
        if (waitUntil) {
          const fallback = { ...message, inlineFallback: true }
          await c.env.INBOUND_EVENTS.send(fallback, {
            delaySeconds: INBOUND_INLINE_FALLBACK_DELAY_S,
          })
          inline.push(fallback)
          return
        }
        await c.env.INBOUND_EVENTS.send(message)
      },
    }

    const log = opts.logFactory?.(c.env) ?? defaultLog
    const result = await ingestWhatsappWebhook(
      {
        store,
        clock,
        queue,
        env: verifyEnv(c.env),
        log,
      },
      { rawBody, signatureHeader: signature },
    )

    if (waitUntil && inline.length > 0) {
      const env = c.env
      waitUntil(
        (async () => {
          for (const message of inline) {
            const started = clock.nowMs()
            try {
              const outcome = await (opts.inlineProcess ?? defaultInlineProcess)(env, message)
              log({
                level: 'info',
                event: 'webhook.inline_processed',
                detail: {
                  receiptId: message.receiptId,
                  tenantId: message.tenantId,
                  kind: message.kind,
                  outcome,
                  inlineMs: clock.nowMs() - started,
                  sinceProviderMs:
                    typeof message.providerTimestamp === 'number'
                      ? clock.nowMs() - message.providerTimestamp
                      : null,
                },
              })
            } catch (err) {
              // Fallback da fila (atrasado) processa; ingest é idempotente por wamid.
              log({
                level: 'warn',
                event: 'webhook.inline_failed',
                detail: {
                  receiptId: message.receiptId,
                  tenantId: message.tenantId,
                  errorCode: (err instanceof Error ? err.message : 'inline_failed').slice(0, 80),
                },
              })
            }
          }
        })(),
      )
    }

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
