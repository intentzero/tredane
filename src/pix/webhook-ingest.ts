/**
 * Ingestão HTTP de webhooks Pix (#39/#40): validar → recibo D1 → fila idempotente.
 * charge.paid / expired / cancelled / refund.updated → Clinic DO.
 */
import type { Clock } from '../db/clock'
import type { AdminDb } from '../db/admin/store'
import type { WorkerBindings } from '../worker/bindings'
import { WOOVI_BASE_URLS } from './woovi/adapter'
import { validatePixWebhookEnvelope } from './webhook-validate'
import {
  findPixWebhookReceiptByKey,
  insertPixWebhookReceipt,
  markPixWebhookReceiptDiscarded,
  markPixWebhookReceiptDuplicate,
  markPixWebhookReceiptEnqueued,
  type PixWebhookReceiptRow,
} from './webhook-receipts'
import type { D1PixWebhookOps } from './webhook-d1'
import type { PixWebhookQueueMessage } from './queue-types'
import type { RawWebhookEnvelope } from './types'

export type PixWebhookReceiptStore = {
  findByKey(key: string): Promise<PixWebhookReceiptRow | undefined>
  insert(input: {
    providerEventKey: string
    provider?: string
    tenantId?: string | null
    accountId?: string | null
    providerChargeId?: string | null
    eventType: PixWebhookReceiptRow['eventType']
    amountCents?: number | null
    detail?: Record<string, unknown> | null
  }): Promise<{ row: PixWebhookReceiptRow; inserted: boolean }>
  markEnqueued(id: string): Promise<void>
  markDuplicate(id: string): Promise<void>
  markDiscarded(id: string, reason: string): Promise<void>
}

export function storeFromAdminDb(
  db: AdminDb,
  clock: Clock,
): PixWebhookReceiptStore {
  return {
    findByKey: async (key) => findPixWebhookReceiptByKey(db, key),
    insert: async (input) => insertPixWebhookReceipt(db, input, clock),
    markEnqueued: async (id) => {
      markPixWebhookReceiptEnqueued(db, id, clock)
    },
    markDuplicate: async (id) => {
      markPixWebhookReceiptDuplicate(db, id, clock)
    },
    markDiscarded: async (id, reason) => {
      markPixWebhookReceiptDiscarded(db, id, reason, clock)
    },
  }
}

export function storeFromD1Ops(ops: D1PixWebhookOps): PixWebhookReceiptStore {
  return {
    findByKey: (key) => ops.findByKey(key),
    insert: (input) => ops.insert(input),
    markEnqueued: (id) => ops.markEnqueued(id),
    markDuplicate: (id) => ops.markDuplicate(id),
    markDiscarded: (id, reason) => ops.markDiscarded(id, reason),
  }
}

export type PixWebhookIngestDeps = {
  store: PixWebhookReceiptStore
  clock: Clock
  queue: { send(message: PixWebhookQueueMessage): Promise<void> }
  env?: WorkerBindings
  publicKeyPems?: string[]
  fetchImpl?: typeof fetch
  baseUrl?: string
  log?: (entry: {
    level: 'info' | 'warn' | 'error'
    event: string
    detail: Record<string, unknown>
  }) => void
}

function safeLog(
  log: PixWebhookIngestDeps['log'],
  level: 'info' | 'warn' | 'error',
  event: string,
  detail: Record<string, unknown>,
): void {
  if (log) {
    log({ level, event, detail })
    return
  }
  const line = JSON.stringify({ channel: 'pix_webhook', event, ...detail })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)
}

function resolvePixMode(env: WorkerBindings | undefined): string {
  return (env?.PIX_MODE ?? 'synthetic').toLowerCase()
}

function resolveWooviBaseUrl(
  env: WorkerBindings | undefined,
  override?: string,
): string {
  if (override) return override
  const mode = resolvePixMode(env)
  if (mode === 'live') return WOOVI_BASE_URLS.live
  return WOOVI_BASE_URLS.sandbox
}

export type PixWebhookIngestResult =
  | { ok: true; status: 200; receiptId: string; duplicate?: boolean }
  | { ok: false; status: 400 | 401 | 503; error: string }

export async function ingestPixWebhook(
  rawBody: string,
  headers: Record<string, string | undefined>,
  deps: PixWebhookIngestDeps,
): Promise<PixWebhookIngestResult> {
  const mode = resolvePixMode(deps.env)
  const envelope: RawWebhookEnvelope = {
    body: rawBody,
    headers,
    receivedAt: new Date(deps.clock.nowMs()).toISOString(),
  }

  const validated = await validatePixWebhookEnvelope(envelope, {
    publicKeyPems: deps.publicKeyPems,
    baseUrl: resolveWooviBaseUrl(deps.env, deps.baseUrl),
    fetchImpl: deps.fetchImpl,
    allowSynthetic: mode === 'synthetic',
    syntheticWebhookSecret: deps.env?.PIX_TOKEN_SECRET ?? 'synth-pix-webhook-secret',
  })

  if (!validated.ok) {
    if (validated.code === 'invalid_signature') {
      safeLog(deps.log, 'warn', 'pix_webhook.invalid_signature', {
        code: validated.code,
      })
      return { ok: false, status: 401, error: 'invalid_signature' }
    }
    if (validated.code === 'provider_unavailable') {
      safeLog(deps.log, 'error', 'pix_webhook.keys_unavailable', {
        code: validated.code,
      })
      return { ok: false, status: 503, error: 'webhook_unconfigured' }
    }
    safeLog(deps.log, 'warn', 'pix_webhook.rejected', {
      code: validated.code,
    })
    return { ok: false, status: 400, error: validated.code }
  }

  const event = validated.value
  const existing = await deps.store.findByKey(event.eventId)
  if (existing) {
    if (
      existing.processingState === 'enqueued' ||
      existing.processingState === 'processed' ||
      existing.processingState === 'duplicate' ||
      existing.processingState === 'discarded'
    ) {
      safeLog(deps.log, 'info', 'pix_webhook.duplicate_receipt', {
        receiptId: existing.id,
        tenantId: existing.tenantId,
      })
      return { ok: true, status: 200, receiptId: existing.id, duplicate: true }
    }
  }

  const { row, inserted } = await deps.store.insert({
    providerEventKey: event.eventId,
    tenantId: event.tenantId,
    accountId: event.accountId,
    providerChargeId: event.providerChargeId,
    eventType: event.type,
    amountCents: event.amountCents,
    detail: {
      type: event.type,
      occurredAt: event.occurredAt,
    },
  })

  if (!inserted) {
    await deps.store.markDuplicate(row.id)
    return { ok: true, status: 200, receiptId: row.id, duplicate: true }
  }

  const supported =
    event.type === 'charge.paid' ||
    event.type === 'charge.expired' ||
    event.type === 'charge.cancelled' ||
    event.type === 'refund.updated'

  if (!supported) {
    await deps.store.markDiscarded(row.id, `unsupported_event:${event.type}`)
    safeLog(deps.log, 'info', 'pix_webhook.discarded_unsupported', {
      receiptId: row.id,
      eventType: event.type,
      tenantId: event.tenantId,
    })
    return { ok: true, status: 200, receiptId: row.id }
  }

  const message: PixWebhookQueueMessage = {
    source: 'pix_webhook',
    receiptId: row.id,
    providerEventKey: event.eventId,
    tenantId: event.tenantId,
    accountId: event.accountId,
    providerChargeId: event.providerChargeId,
    eventType: event.type,
    amountCents: event.amountCents,
    occurredAt: event.occurredAt,
    refund: event.refund
      ? {
          providerRefundId: event.refund.providerRefundId,
          status: event.refund.status,
          amountCents: event.refund.amountCents,
          failureReason: event.refund.failureReason ?? null,
        }
      : null,
  }

  try {
    await deps.queue.send(message)
    await deps.store.markEnqueued(row.id)
    safeLog(deps.log, 'info', 'pix_webhook.enqueued', {
      receiptId: row.id,
      tenantId: event.tenantId,
    })
    return { ok: true, status: 200, receiptId: row.id }
  } catch (e) {
    safeLog(deps.log, 'error', 'pix_webhook.enqueue_failed', {
      receiptId: row.id,
      tenantId: event.tenantId,
      error: e instanceof Error ? e.message : 'enqueue_failed',
    })
    return { ok: false, status: 503, error: 'enqueue_failed' }
  }
}

export type { PixWebhookReceiptRow }
