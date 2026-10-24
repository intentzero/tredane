/**
 * Recibos D1 de webhooks WhatsApp (#32).
 * Persistência antes do ack HTTP; dedup por provider_event_key.
 * detail_json: só metadados técnicos (sem corpo, telefone de contacto ou token).
 */
import type { Clock } from '../db/clock'
import { assertAdminSchemaReady } from '../db/admin/gate'
import type { AdminDb } from '../db/admin/store'
import { newId } from '../clinic/ids'

export const WEBHOOK_RECEIPT_KINDS = [
  'message',
  'media',
  'unsupported',
  'status',
  'account_interrupt',
  'discarded',
] as const
export type WebhookReceiptKind = (typeof WEBHOOK_RECEIPT_KINDS)[number]

export const WEBHOOK_RECEIPT_STATES = [
  'received',
  'enqueued',
  'processed',
  'duplicate',
  'discarded',
  'failed',
] as const
export type WebhookReceiptState = (typeof WEBHOOK_RECEIPT_STATES)[number]

export type WebhookReceiptRow = {
  id: string
  providerEventKey: string
  phoneNumberId: string | null
  tenantId: string | null
  bindingId: string | null
  kind: WebhookReceiptKind
  processingState: WebhookReceiptState
  providerTimestamp: number | null
  detailJson: string | null
  enqueuedAt: number | null
  processedAt: number | null
  lastError: string | null
  createdAt: number
}

type ReceiptSql = {
  id: string
  provider_event_key: string
  phone_number_id: string | null
  tenant_id: string | null
  binding_id: string | null
  kind: string
  processing_state: string
  provider_timestamp: number | null
  detail_json: string | null
  enqueued_at: number | null
  processed_at: number | null
  last_error: string | null
  created_at: number
}

function mapRow(row: ReceiptSql): WebhookReceiptRow {
  return {
    id: row.id,
    providerEventKey: row.provider_event_key,
    phoneNumberId: row.phone_number_id,
    tenantId: row.tenant_id,
    bindingId: row.binding_id,
    kind: row.kind as WebhookReceiptKind,
    processingState: row.processing_state as WebhookReceiptState,
    providerTimestamp: row.provider_timestamp,
    detailJson: row.detail_json,
    enqueuedAt: row.enqueued_at,
    processedAt: row.processed_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  }
}

export function findWebhookReceiptByKey(
  db: AdminDb,
  providerEventKey: string,
): WebhookReceiptRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<ReceiptSql>(
    `SELECT * FROM whatsapp_webhook_receipts WHERE provider_event_key = ? LIMIT 1`,
    providerEventKey,
  )
  return row ? mapRow(row) : undefined
}

export function getWebhookReceiptById(
  db: AdminDb,
  id: string,
): WebhookReceiptRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<ReceiptSql>(
    `SELECT * FROM whatsapp_webhook_receipts WHERE id = ? LIMIT 1`,
    id,
  )
  return row ? mapRow(row) : undefined
}

/**
 * Insere recibo; se a chave já existir, devolve o existente (duplicate=true).
 */
export function insertWebhookReceipt(
  db: AdminDb,
  clock: Clock,
  input: {
    providerEventKey: string
    phoneNumberId?: string | null
    tenantId?: string | null
    bindingId?: string | null
    kind: WebhookReceiptKind
    processingState?: WebhookReceiptState
    providerTimestamp?: number | null
    detail?: Record<string, unknown> | null
  },
): { row: WebhookReceiptRow; duplicate: boolean } {
  assertAdminSchemaReady(db)
  const existing = findWebhookReceiptByKey(db, input.providerEventKey)
  if (existing) {
    return { row: existing, duplicate: true }
  }

  const id = newId('whr')
  const createdAt = clock.nowMs()
  const state = input.processingState ?? 'received'
  const detailJson = input.detail ? JSON.stringify(input.detail) : null

  try {
    db.run(
      `INSERT INTO whatsapp_webhook_receipts (
        id, provider_event_key, phone_number_id, tenant_id, binding_id,
        kind, processing_state, provider_timestamp, detail_json,
        enqueued_at, processed_at, last_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
      id,
      input.providerEventKey,
      input.phoneNumberId ?? null,
      input.tenantId ?? null,
      input.bindingId ?? null,
      input.kind,
      state,
      input.providerTimestamp ?? null,
      detailJson,
      createdAt,
    )
  } catch {
    const again = findWebhookReceiptByKey(db, input.providerEventKey)
    if (again) return { row: again, duplicate: true }
    throw new Error('webhook_receipt_insert_failed')
  }

  return {
    row: {
      id,
      providerEventKey: input.providerEventKey,
      phoneNumberId: input.phoneNumberId ?? null,
      tenantId: input.tenantId ?? null,
      bindingId: input.bindingId ?? null,
      kind: input.kind,
      processingState: state,
      providerTimestamp: input.providerTimestamp ?? null,
      detailJson,
      enqueuedAt: null,
      processedAt: null,
      lastError: null,
      createdAt,
    },
    duplicate: false,
  }
}

export function markWebhookReceiptEnqueued(
  db: AdminDb,
  id: string,
  clock: Clock,
): void {
  assertAdminSchemaReady(db)
  db.run(
    `UPDATE whatsapp_webhook_receipts
     SET processing_state = 'enqueued', enqueued_at = ?, last_error = NULL
     WHERE id = ? AND processing_state IN ('received', 'failed')`,
    clock.nowMs(),
    id,
  )
}

export function markWebhookReceiptProcessed(
  db: AdminDb,
  id: string,
  clock: Clock,
  detail?: Record<string, unknown>,
): void {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  if (detail) {
    db.run(
      `UPDATE whatsapp_webhook_receipts
       SET processing_state = 'processed', processed_at = ?, last_error = NULL,
           detail_json = ?
       WHERE id = ?`,
      now,
      JSON.stringify(detail),
      id,
    )
    return
  }
  db.run(
    `UPDATE whatsapp_webhook_receipts
     SET processing_state = 'processed', processed_at = ?, last_error = NULL
     WHERE id = ?`,
    now,
    id,
  )
}

export function markWebhookReceiptFailed(
  db: AdminDb,
  id: string,
  errorCode: string,
): void {
  assertAdminSchemaReady(db)
  db.run(
    `UPDATE whatsapp_webhook_receipts
     SET processing_state = 'failed', last_error = ?
     WHERE id = ?`,
    errorCode.slice(0, 200),
    id,
  )
}

export function markWebhookReceiptDiscarded(
  db: AdminDb,
  id: string,
  clock: Clock,
  reason: string,
): void {
  assertAdminSchemaReady(db)
  db.run(
    `UPDATE whatsapp_webhook_receipts
     SET processing_state = 'discarded', processed_at = ?, last_error = ?
     WHERE id = ?`,
    clock.nowMs(),
    reason.slice(0, 200),
    id,
  )
}

/**
 * Redrive auditado: repor estado para re-enfileirar (DLQ / falha).
 * Não altera provider_event_key — o DO continua idempotente.
 */
export function prepareWebhookReceiptRedrive(
  db: AdminDb,
  id: string,
  clock: Clock,
): WebhookReceiptRow | null {
  assertAdminSchemaReady(db)
  const row = getWebhookReceiptById(db, id)
  if (!row) return null
  if (row.processingState !== 'failed' && row.processingState !== 'enqueued') {
    return null
  }
  if (!row.tenantId || !row.bindingId) return null
  db.run(
    `UPDATE whatsapp_webhook_receipts
     SET processing_state = 'received', last_error = NULL,
         detail_json = ?
     WHERE id = ?`,
    JSON.stringify({ redriveAt: clock.nowMs(), previousState: row.processingState }),
    id,
  )
  return getWebhookReceiptById(db, id) ?? null
}
