/**
 * Operações D1 async para webhooks (#32) — espelho de webhook-receipts + resolve.
 */
import type { Clock } from '../db/clock'
import { ADMIN_SCHEMA_VERSION } from '../db/admin/constants'
import { newId } from '../clinic/ids'
import type { WhatsappBindingStatus } from './types'
import type {
  WebhookReceiptKind,
  WebhookReceiptRow,
  WebhookReceiptState,
} from './webhook-receipts'

type BindingSql = {
  id: string
  phone_number_id: string
  tenant_id: string
  status: string
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

function mapReceipt(row: ReceiptSql): WebhookReceiptRow {
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

async function assertSchema(db: D1Database): Promise<void> {
  const row = await db
    .prepare('SELECT version FROM admin_schema_state WHERE id = 1')
    .first<{ version: number }>()
  if (!row || row.version !== ADMIN_SCHEMA_VERSION) {
    throw new Error(
      `admin schema ${row?.version ?? 'ausente'}; esperada ${ADMIN_SCHEMA_VERSION}`,
    )
  }
}

export type D1WebhookOps = {
  resolveTenantByPhoneNumberId(
    phoneNumberId: string,
  ): Promise<{ tenantId: string; bindingId: string; status: WhatsappBindingStatus } | null>
  findReceiptByKey(providerEventKey: string): Promise<WebhookReceiptRow | undefined>
  getReceiptById(id: string): Promise<WebhookReceiptRow | undefined>
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
  markProcessed(id: string, detail?: Record<string, unknown>): Promise<void>
  markFailed(id: string, errorCode: string): Promise<void>
  markDiscarded(id: string, reason: string): Promise<void>
  markBindingInterrupted(input: {
    phoneNumberId: string
    reason: string
  }): Promise<{ tenantId: string; bindingId: string } | null>
}

export function createD1WebhookOps(db: D1Database, clock: Clock): D1WebhookOps {
  return {
    async resolveTenantByPhoneNumberId(phoneNumberId) {
      await assertSchema(db)
      const row = await db
        .prepare(
          `SELECT id, phone_number_id, tenant_id, status FROM whatsapp_phone_bindings
           WHERE phone_number_id = ? AND status IN ('active', 'interrupted') LIMIT 1`,
        )
        .bind(phoneNumberId)
        .first<BindingSql>()
      if (!row) return null
      return {
        tenantId: row.tenant_id,
        bindingId: row.id,
        status: row.status as WhatsappBindingStatus,
      }
    },

    async findReceiptByKey(providerEventKey) {
      await assertSchema(db)
      const row = await db
        .prepare(
          `SELECT * FROM whatsapp_webhook_receipts WHERE provider_event_key = ? LIMIT 1`,
        )
        .bind(providerEventKey)
        .first<ReceiptSql>()
      return row ? mapReceipt(row) : undefined
    },

    async getReceiptById(id) {
      await assertSchema(db)
      const row = await db
        .prepare(`SELECT * FROM whatsapp_webhook_receipts WHERE id = ? LIMIT 1`)
        .bind(id)
        .first<ReceiptSql>()
      return row ? mapReceipt(row) : undefined
    },

    async insertReceipt(input) {
      await assertSchema(db)
      const existing = await this.findReceiptByKey(input.providerEventKey)
      if (existing) return { row: existing, duplicate: true }

      const id = newId('whr')
      const createdAt = clock.nowMs()
      const state = input.processingState ?? 'received'
      const detailJson = input.detail ? JSON.stringify(input.detail) : null
      try {
        await db
          .prepare(
            `INSERT INTO whatsapp_webhook_receipts (
              id, provider_event_key, phone_number_id, tenant_id, binding_id,
              kind, processing_state, provider_timestamp, detail_json,
              enqueued_at, processed_at, last_error, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
          )
          .bind(
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
          .run()
      } catch {
        const again = await this.findReceiptByKey(input.providerEventKey)
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
    },

    async markEnqueued(id) {
      await db
        .prepare(
          `UPDATE whatsapp_webhook_receipts
           SET processing_state = 'enqueued', enqueued_at = ?, last_error = NULL
           WHERE id = ? AND processing_state IN ('received', 'failed')`,
        )
        .bind(clock.nowMs(), id)
        .run()
    },

    async markProcessed(id, detail) {
      const now = clock.nowMs()
      if (detail) {
        await db
          .prepare(
            `UPDATE whatsapp_webhook_receipts
             SET processing_state = 'processed', processed_at = ?, last_error = NULL,
                 detail_json = ?
             WHERE id = ?`,
          )
          .bind(now, JSON.stringify(detail), id)
          .run()
        return
      }
      await db
        .prepare(
          `UPDATE whatsapp_webhook_receipts
           SET processing_state = 'processed', processed_at = ?, last_error = NULL
           WHERE id = ?`,
        )
        .bind(now, id)
        .run()
    },

    async markFailed(id, errorCode) {
      await db
        .prepare(
          `UPDATE whatsapp_webhook_receipts
           SET processing_state = 'failed', last_error = ?
           WHERE id = ?`,
        )
        .bind(errorCode.slice(0, 200), id)
        .run()
    },

    async markDiscarded(id, reason) {
      await db
        .prepare(
          `UPDATE whatsapp_webhook_receipts
           SET processing_state = 'discarded', processed_at = ?, last_error = ?
           WHERE id = ?`,
        )
        .bind(clock.nowMs(), reason.slice(0, 200), id)
        .run()
    },

    async markBindingInterrupted(input) {
      await assertSchema(db)
      const binding = await db
        .prepare(
          `SELECT id, tenant_id, status FROM whatsapp_phone_bindings
           WHERE phone_number_id = ? AND status = 'active' LIMIT 1`,
        )
        .bind(input.phoneNumberId)
        .first<{ id: string; tenant_id: string; status: string }>()
      if (!binding) return null
      const now = clock.nowMs()
      await db.batch([
        db
          .prepare(
            `UPDATE whatsapp_phone_bindings
             SET status = 'interrupted', interrupted_at = ?, interrupt_reason = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(now, input.reason.slice(0, 200), now, binding.id),
        db
          .prepare(`DELETE FROM whatsapp_credentials WHERE binding_id = ?`)
          .bind(binding.id),
        db
          .prepare(
            `INSERT INTO whatsapp_binding_events (
              id, tenant_id, binding_id, phone_number_id, action,
              actor_clerk_user_id, detail_json, occurred_at
            ) VALUES (?, ?, ?, ?, 'interrupted', NULL, ?, ?)`,
          )
          .bind(
            newId('wbe'),
            binding.tenant_id,
            binding.id,
            input.phoneNumberId,
            JSON.stringify({ reason: input.reason, source: 'webhook' }),
            now,
          ),
      ])
      return { tenantId: binding.tenant_id, bindingId: binding.id }
    },
  }
}
