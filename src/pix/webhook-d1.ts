/**
 * Operações D1 async para recibos de webhook Pix (#39).
 */
import type { Clock } from '../db/clock'
import { ADMIN_SCHEMA_VERSION } from '../db/admin/constants'
import { newId } from '../clinic/ids'
import type {
  PixWebhookReceiptEventType,
  PixWebhookReceiptRow,
  PixWebhookReceiptState,
} from './webhook-receipts'

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

export type D1PixWebhookOps = {
  findByKey(providerEventKey: string): Promise<PixWebhookReceiptRow | undefined>
  insert(input: {
    providerEventKey: string
    provider?: string
    tenantId?: string | null
    accountId?: string | null
    providerChargeId?: string | null
    eventType: PixWebhookReceiptEventType
    amountCents?: number | null
    detail?: Record<string, unknown> | null
  }): Promise<{ row: PixWebhookReceiptRow; inserted: boolean }>
  markEnqueued(id: string): Promise<void>
  markProcessed(id: string): Promise<void>
  markDuplicate(id: string): Promise<void>
  markDiscarded(id: string, reason: string): Promise<void>
  markFailed(id: string, error: string): Promise<void>
}

async function assertSchema(db: D1Database): Promise<void> {
  const row = await db
    .prepare(`SELECT version FROM admin_schema_state WHERE id = 1`)
    .first<{ version: number }>()
  if (!row || row.version !== ADMIN_SCHEMA_VERSION) {
    throw new Error(
      `admin schema ${row?.version ?? 'ausente'}; esperada ${ADMIN_SCHEMA_VERSION}`,
    )
  }
}

export function createD1PixWebhookOps(
  db: D1Database,
  clock: Clock,
): D1PixWebhookOps {
  return {
    async findByKey(providerEventKey) {
      await assertSchema(db)
      const row = await db
        .prepare(
          `SELECT * FROM pix_webhook_receipts WHERE provider_event_key = ? LIMIT 1`,
        )
        .bind(providerEventKey)
        .first<ReceiptSql>()
      return row ? mapRow(row) : undefined
    },

    async insert(input) {
      await assertSchema(db)
      const existing = await this.findByKey(input.providerEventKey)
      if (existing) return { row: existing, inserted: false }
      const id = newId('pixwhr')
      const now = clock.nowMs()
      try {
        await db
          .prepare(
            `INSERT INTO pix_webhook_receipts (
              id, provider_event_key, provider, tenant_id, account_id, provider_charge_id,
              event_type, processing_state, amount_cents, detail_json,
              enqueued_at, processed_at, last_error, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, NULL, NULL, NULL, ?)`,
          )
          .bind(
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
          .run()
      } catch {
        const raced = await this.findByKey(input.providerEventKey)
        if (raced) return { row: raced, inserted: false }
        throw new Error('pix_webhook_receipt_insert_failed')
      }
      const row = await db
        .prepare(`SELECT * FROM pix_webhook_receipts WHERE id = ? LIMIT 1`)
        .bind(id)
        .first<ReceiptSql>()
      return { row: mapRow(row!), inserted: true }
    },

    async markEnqueued(id) {
      await assertSchema(db)
      await db
        .prepare(
          `UPDATE pix_webhook_receipts
           SET processing_state = 'enqueued', enqueued_at = ?
           WHERE id = ? AND processing_state IN ('received', 'enqueued')`,
        )
        .bind(clock.nowMs(), id)
        .run()
    },

    async markProcessed(id) {
      await assertSchema(db)
      await db
        .prepare(
          `UPDATE pix_webhook_receipts
           SET processing_state = 'processed', processed_at = ?, last_error = NULL
           WHERE id = ?`,
        )
        .bind(clock.nowMs(), id)
        .run()
    },

    async markDuplicate(id) {
      await assertSchema(db)
      await db
        .prepare(
          `UPDATE pix_webhook_receipts
           SET processing_state = 'duplicate', processed_at = ?
           WHERE id = ?`,
        )
        .bind(clock.nowMs(), id)
        .run()
    },

    async markDiscarded(id, reason) {
      await assertSchema(db)
      await db
        .prepare(
          `UPDATE pix_webhook_receipts
           SET processing_state = 'discarded', processed_at = ?, last_error = ?
           WHERE id = ?`,
        )
        .bind(clock.nowMs(), reason.slice(0, 200), id)
        .run()
    },

    async markFailed(id, error) {
      await assertSchema(db)
      await db
        .prepare(
          `UPDATE pix_webhook_receipts
           SET processing_state = 'failed', last_error = ?
           WHERE id = ?`,
        )
        .bind(error.slice(0, 500), id)
        .run()
    },
  }
}
