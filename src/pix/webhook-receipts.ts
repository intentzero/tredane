/**
 * Recibos D1 de webhooks Pix (#39).
 * Persistência antes do ack HTTP; dedup por provider_event_key.
 * detail_json: só metadados técnicos (sem App ID, chave Pix ou dados bancários).
 */
import type { Clock } from '../db/clock'
import { assertAdminSchemaReady } from '../db/admin/gate'
import type { AdminDb } from '../db/admin/store'
import { newId } from '../clinic/ids'
import type { WebhookEventType } from './types'

export const PIX_WEBHOOK_RECEIPT_STATES = [
  'received',
  'enqueued',
  'processed',
  'duplicate',
  'discarded',
  'failed',
] as const
export type PixWebhookReceiptState = (typeof PIX_WEBHOOK_RECEIPT_STATES)[number]

export type PixWebhookReceiptEventType = WebhookEventType | 'discarded'

export type PixWebhookReceiptRow = {
  id: string
  providerEventKey: string
  provider: string
  tenantId: string | null
  accountId: string | null
  providerChargeId: string | null
  eventType: PixWebhookReceiptEventType
  processingState: PixWebhookReceiptState
  amountCents: number | null
  detailJson: string | null
  enqueuedAt: number | null
  processedAt: number | null
  lastError: string | null
  createdAt: number
}

type ReceiptSql = {
  id: string
  provider_event_key: string
  provider: string
  tenant_id: string | null
  account_id: string | null
  provider_charge_id: string | null
  event_type: string
  processing_state: string
  amount_cents: number | null
  detail_json: string | null
  enqueued_at: number | null
  processed_at: number | null
  last_error: string | null
  created_at: number
}

function mapRow(row: ReceiptSql): PixWebhookReceiptRow {
  return {
    id: row.id,
    providerEventKey: row.provider_event_key,
    provider: row.provider,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    providerChargeId: row.provider_charge_id,
    eventType: row.event_type as PixWebhookReceiptEventType,
    processingState: row.processing_state as PixWebhookReceiptState,
    amountCents: row.amount_cents,
    detailJson: row.detail_json,
    enqueuedAt: row.enqueued_at,
    processedAt: row.processed_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  }
}

export function findPixWebhookReceiptByKey(
  db: AdminDb,
  providerEventKey: string,
): PixWebhookReceiptRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<ReceiptSql>(
    `SELECT * FROM pix_webhook_receipts WHERE provider_event_key = ? LIMIT 1`,
    providerEventKey,
  )
  return row ? mapRow(row) : undefined
}

export function getPixWebhookReceiptById(
  db: AdminDb,
  id: string,
): PixWebhookReceiptRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<ReceiptSql>(
    `SELECT * FROM pix_webhook_receipts WHERE id = ? LIMIT 1`,
    id,
  )
  return row ? mapRow(row) : undefined
}

export function insertPixWebhookReceipt(
  db: AdminDb,
  input: {
    providerEventKey: string
    provider?: string
    tenantId?: string | null
    accountId?: string | null
    providerChargeId?: string | null
    eventType: PixWebhookReceiptEventType
    amountCents?: number | null
    detail?: Record<string, unknown> | null
  },
  clock: Clock,
): { row: PixWebhookReceiptRow; inserted: boolean } {
  assertAdminSchemaReady(db)
  const existing = findPixWebhookReceiptByKey(db, input.providerEventKey)
  if (existing) {
    return { row: existing, inserted: false }
  }
  const id = newId('pixwhr')
  const now = clock.nowMs()
  try {
    db.run(
      `INSERT INTO pix_webhook_receipts (
        id, provider_event_key, provider, tenant_id, account_id, provider_charge_id,
        event_type, processing_state, amount_cents, detail_json,
        enqueued_at, processed_at, last_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, NULL, NULL, NULL, ?)`,
      id,
      input.providerEventKey,
      input.provider ?? 'woovi',
      input.tenantId ?? null,
      input.accountId ?? null,
      input.providerChargeId ?? null,
      input.eventType,
      input.amountCents ?? null,
      input.detail ? JSON.stringify(input.detail) : null,
      now,
    )
  } catch {
    const raced = findPixWebhookReceiptByKey(db, input.providerEventKey)
    if (raced) return { row: raced, inserted: false }
    throw new Error('pix_webhook_receipt_insert_failed')
  }
  return { row: getPixWebhookReceiptById(db, id)!, inserted: true }
}

export function markPixWebhookReceiptEnqueued(
  db: AdminDb,
  id: string,
  clock: Clock,
): void {
  assertAdminSchemaReady(db)
  db.run(
    `UPDATE pix_webhook_receipts
     SET processing_state = 'enqueued', enqueued_at = ?
     WHERE id = ? AND processing_state IN ('received', 'enqueued')`,
    clock.nowMs(),
    id,
  )
}

export function markPixWebhookReceiptProcessed(
  db: AdminDb,
  id: string,
  clock: Clock,
): void {
  assertAdminSchemaReady(db)
  db.run(
    `UPDATE pix_webhook_receipts
     SET processing_state = 'processed', processed_at = ?, last_error = NULL
     WHERE id = ?`,
    clock.nowMs(),
    id,
  )
}

export function markPixWebhookReceiptDuplicate(
  db: AdminDb,
  id: string,
  clock: Clock,
): void {
  assertAdminSchemaReady(db)
  db.run(
    `UPDATE pix_webhook_receipts
     SET processing_state = 'duplicate', processed_at = ?
     WHERE id = ?`,
    clock.nowMs(),
    id,
  )
}

export function markPixWebhookReceiptDiscarded(
  db: AdminDb,
  id: string,
  reason: string,
  clock: Clock,
): void {
  assertAdminSchemaReady(db)
  db.run(
    `UPDATE pix_webhook_receipts
     SET processing_state = 'discarded', processed_at = ?, last_error = ?
     WHERE id = ?`,
    clock.nowMs(),
    reason.slice(0, 200),
    id,
  )
}

export function markPixWebhookReceiptFailed(
  db: AdminDb,
  id: string,
  error: string,
  _clock: Clock,
): void {
  assertAdminSchemaReady(db)
  void _clock
  db.run(
    `UPDATE pix_webhook_receipts
     SET processing_state = 'failed', last_error = ?
     WHERE id = ?`,
    error.slice(0, 500),
    id,
  )
}
