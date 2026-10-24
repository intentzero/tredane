/**
 * Orquestração HTTP → recibo D1 → Queue (#32 / REQ-011/050).
 * Tenant só via phone_number_id verificado; nunca clinicId do payload.
 */
import type { Clock } from '../db/clock'
import type { AdminDb } from '../db/admin/store'
import { resolveTenantByPhoneNumberId } from './bindings'
import {
  parseWhatsappWebhookPayload,
  type ParsedWebhookItem,
} from './webhook-parse'
import {
  insertWebhookReceipt,
  markWebhookReceiptEnqueued,
  type WebhookReceiptKind,
  type WebhookReceiptRow,
  type WebhookReceiptState,
} from './webhook-receipts'
import type { D1WebhookOps } from './webhook-d1'
import type { WhatsappWebhookQueueMessage } from './queue-types'
import type { WhatsappBindingStatus } from './types'
import {
  resolveAppSecret,
  verifyHubSignature256,
  type WebhookVerifyEnv,
} from './webhook-verify'

export type WebhookIngestLog = {
  level: 'info' | 'warn' | 'error'
  event: string
  detail: Record<string, unknown>
}

export type WebhookTenantResolve = {
  tenantId: string
  bindingId: string
  status: WhatsappBindingStatus
}

/** Abstração sync (testes) / async (D1). */
export type WebhookReceiptStore = {
  resolveTenant(phoneNumberId: string): Promise<WebhookTenantResolve | null>
  insertReceipt(input: {
    providerEventKey: string
    phoneNumberId?: string | null
    tenantId?: string | null
    bindingId?: string | null
    kind: WebhookReceiptKind
    processingState?: WebhookReceiptState
    providerTimestamp?: number | null
    detail?: Record<string, unknown> | null
  }): Promise<{ row: WebhookReceiptRow; duplicate: boolean }>
  markEnqueued(id: string): Promise<void>
}

export type WebhookIngestDeps = {
  store: WebhookReceiptStore
  clock: Clock
  queue: { send(message: WhatsappWebhookQueueMessage): Promise<void> }
  env: WebhookVerifyEnv
  log?: (entry: WebhookIngestLog) => void
}

export type WebhookIngestResult =
  | { ok: true; status: 200; enqueued: number; duplicates: number; discarded: number }
  | { ok: false; status: 401 | 503; error: string }

function safeLog(
  log: WebhookIngestDeps['log'],
  level: WebhookIngestLog['level'],
  event: string,
  detail: Record<string, unknown>,
): void {
  log?.({ level, event, detail })
}

export function storeFromAdminDb(db: AdminDb, clock: Clock): WebhookReceiptStore {
  return {
    async resolveTenant(phoneNumberId) {
      return resolveTenantByPhoneNumberId(db, phoneNumberId)
    },
    async insertReceipt(input) {
      return insertWebhookReceipt(db, clock, input)
    },
    async markEnqueued(id) {
      markWebhookReceiptEnqueued(db, id, clock)
    },
  }
}

export function storeFromD1Ops(ops: D1WebhookOps): WebhookReceiptStore {
  return {
    resolveTenant: (phoneNumberId) => ops.resolveTenantByPhoneNumberId(phoneNumberId),
    insertReceipt: (input) => ops.insertReceipt(input),
    markEnqueued: (id) => ops.markEnqueued(id),
  }
}

function itemToQueueMessage(
  receipt: WebhookReceiptRow,
  item: ParsedWebhookItem,
  tenantId: string,
  bindingId: string,
): WhatsappWebhookQueueMessage {
  const base = {
    source: 'whatsapp_webhook' as const,
    receiptId: receipt.id,
    providerEventKey: item.providerEventKey,
    tenantId,
    bindingId,
    phoneNumberId: item.phoneNumberId,
  }
  switch (item.kind) {
    case 'message':
      return {
        ...base,
        kind: 'message',
        waId: item.waId,
        displayName: item.displayName,
        body: item.body,
        messageType: item.messageType,
        providerTimestamp: item.providerTimestamp,
      }
    case 'media':
      return {
        ...base,
        kind: 'media',
        waId: item.waId,
        displayName: item.displayName,
        body: item.body,
        messageType: item.messageType,
        mediaId: item.media.mediaId,
        mediaMimeType: item.media.mimeType,
        mediaFilename: item.media.filename,
        providerTimestamp: item.providerTimestamp,
      }
    case 'unsupported':
      return {
        ...base,
        kind: 'unsupported',
        waId: item.waId,
        displayName: item.displayName,
        body: item.body,
        messageType: item.messageType,
        providerTimestamp: item.providerTimestamp,
      }
    case 'status':
      return {
        ...base,
        kind: 'status',
        status: item.status,
        statusMessageId: item.statusMessageId,
        providerTimestamp: item.providerTimestamp,
      }
    case 'account_interrupt':
      return {
        ...base,
        kind: 'account_interrupt',
        interruptReason: item.interruptReason,
        providerTimestamp: item.providerTimestamp,
      }
  }
}

/**
 * Valida assinatura no corpo original, resolve tenants, persiste recibos e enfileira.
 * Ack 200 só após enfileirar (ou confirmar duplicata já tratada).
 */
export async function ingestWhatsappWebhook(
  deps: WebhookIngestDeps,
  input: {
    rawBody: string
    signatureHeader: string | null
  },
): Promise<WebhookIngestResult> {
  const appSecret = resolveAppSecret(deps.env)
  if (!appSecret) {
    safeLog(deps.log, 'error', 'webhook.secret_unconfigured', {})
    return { ok: false, status: 503, error: 'webhook_unconfigured' }
  }

  const valid = await verifyHubSignature256(
    input.rawBody,
    input.signatureHeader,
    appSecret,
  )
  if (!valid) {
    safeLog(deps.log, 'warn', 'webhook.invalid_signature', {})
    return { ok: false, status: 401, error: 'invalid_signature' }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(input.rawBody) as unknown
  } catch {
    safeLog(deps.log, 'warn', 'webhook.invalid_json', {})
    return { ok: false, status: 401, error: 'invalid_json' }
  }

  const { items, discarded: parseDiscarded } = parseWhatsappWebhookPayload(parsedJson)
  let enqueued = 0
  let duplicates = 0
  let discarded = parseDiscarded.length

  for (const d of parseDiscarded) {
    await deps.store.insertReceipt({
      providerEventKey: d.providerEventKey,
      kind: 'discarded',
      processingState: 'discarded',
      detail: { reason: d.reason },
    })
    safeLog(deps.log, 'info', 'webhook.discarded', {
      reason: d.reason,
      providerEventKey: d.providerEventKey,
    })
  }

  for (const item of items) {
    const resolved = await deps.store.resolveTenant(item.phoneNumberId)
    if (!resolved) {
      discarded += 1
      await deps.store.insertReceipt({
        providerEventKey: item.providerEventKey,
        phoneNumberId: item.phoneNumberId,
        kind: 'discarded',
        processingState: 'discarded',
        providerTimestamp: item.providerTimestamp,
        detail: { reason: 'unknown_or_released_phone' },
      })
      safeLog(deps.log, 'info', 'webhook.unresolved_phone', {
        phoneNumberId: item.phoneNumberId,
        providerEventKey: item.providerEventKey,
        kind: item.kind,
      })
      continue
    }

    const { row, duplicate } = await deps.store.insertReceipt({
      providerEventKey: item.providerEventKey,
      phoneNumberId: item.phoneNumberId,
      tenantId: resolved.tenantId,
      bindingId: resolved.bindingId,
      kind: item.kind,
      processingState: 'received',
      providerTimestamp: item.providerTimestamp,
      detail: {
        kind: item.kind,
        bindingStatus: resolved.status,
      },
    })

    if (duplicate) {
      duplicates += 1
      if (
        row.processingState === 'enqueued' ||
        row.processingState === 'processed' ||
        row.processingState === 'duplicate' ||
        row.processingState === 'discarded'
      ) {
        safeLog(deps.log, 'info', 'webhook.duplicate_receipt', {
          receiptId: row.id,
          providerEventKey: item.providerEventKey,
          tenantId: resolved.tenantId,
          state: row.processingState,
        })
        continue
      }
    }

    const message = itemToQueueMessage(
      row,
      item,
      resolved.tenantId,
      resolved.bindingId,
    )

    try {
      await deps.queue.send(message)
      await deps.store.markEnqueued(row.id)
      enqueued += 1
      safeLog(deps.log, 'info', 'webhook.enqueued', {
        receiptId: row.id,
        providerEventKey: item.providerEventKey,
        tenantId: resolved.tenantId,
        kind: item.kind,
      })
    } catch (err) {
      const code = err instanceof Error ? err.message : 'queue_send_failed'
      safeLog(deps.log, 'error', 'webhook.enqueue_failed', {
        receiptId: row.id,
        tenantId: resolved.tenantId,
        errorCode: code.slice(0, 80),
      })
      return { ok: false, status: 503, error: 'queue_unavailable' }
    }
  }

  return { ok: true, status: 200, enqueued, duplicates, discarded }
}
