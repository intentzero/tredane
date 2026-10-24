import type { Clock } from '../db/clock'
import type { OutboxState } from './constants'
import { assertClinicSchemaReady } from './migrations'
import type { ClinicDb } from './store'
import { newId } from './ids'
import type { ConsumerResult, EventEnvelope } from './envelopes'
import { ConflictError, NotFoundError } from './errors'

export type OutboxRow = {
  id: string
  tenantId: string
  type: string
  aggregateType: string
  aggregateId: string
  version: number
  processingState: OutboxState
  payloadJson: string
  idempotencyKey: string
  occurredAt: number
  publishedAt: number | null
  acknowledgedAt: number | null
  attemptCount: number
  lastError: string | null
}

export type OutboxInsert = {
  tenantId: string
  type: string
  aggregateType: string
  aggregateId: string
  payload: Record<string, unknown>
  idempotencyKey: string
  version?: number
  id?: string
}

function mapRow(row: {
  id: string
  tenant_id: string
  type: string
  aggregate_type: string
  aggregate_id: string
  version: number
  processing_state: string
  payload_json: string
  idempotency_key: string
  occurred_at: number
  published_at: number | null
  acknowledged_at: number | null
  attempt_count: number
  last_error: string | null
}): OutboxRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    version: row.version,
    processingState: row.processing_state as OutboxState,
    payloadJson: row.payload_json,
    idempotencyKey: row.idempotency_key,
    occurredAt: row.occurred_at,
    publishedAt: row.published_at,
    acknowledgedAt: row.acknowledged_at,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
  }
}

/** Inserção de outbox — deve ocorrer dentro de transactionSync com a mutação. */
export function insertOutboxEvent(
  db: ClinicDb,
  input: OutboxInsert,
  clock: Clock,
): OutboxRow {
  assertClinicSchemaReady(db)
  const existing = db.get<{
    id: string
    tenant_id: string
    type: string
    aggregate_type: string
    aggregate_id: string
    version: number
    processing_state: string
    payload_json: string
    idempotency_key: string
    occurred_at: number
    published_at: number | null
    acknowledged_at: number | null
    attempt_count: number
    last_error: string | null
  }>(
    `SELECT * FROM outbox_events WHERE tenant_id = ? AND idempotency_key = ?`,
    input.tenantId,
    input.idempotencyKey,
  )
  if (existing) return mapRow(existing)

  const id = input.id ?? newId('obx')
  const occurredAt = clock.nowMs()
  const payloadJson = JSON.stringify(input.payload)
  db.run(
    `INSERT INTO outbox_events (
      id, tenant_id, type, aggregate_type, aggregate_id, version,
      processing_state, payload_json, idempotency_key, occurred_at,
      published_at, acknowledged_at, attempt_count, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL, NULL, 0, NULL)`,
    id,
    input.tenantId,
    input.type,
    input.aggregateType,
    input.aggregateId,
    input.version ?? 1,
    payloadJson,
    input.idempotencyKey,
    occurredAt,
  )
  return {
    id,
    tenantId: input.tenantId,
    type: input.type,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    version: input.version ?? 1,
    processingState: 'pending',
    payloadJson,
    idempotencyKey: input.idempotencyKey,
    occurredAt,
    publishedAt: null,
    acknowledgedAt: null,
    attemptCount: 0,
    lastError: null,
  }
}

export function listPendingOutbox(
  db: ClinicDb,
  tenantId: string,
  limit = 50,
): OutboxRow[] {
  assertClinicSchemaReady(db)
  return db
    .all<{
      id: string
      tenant_id: string
      type: string
      aggregate_type: string
      aggregate_id: string
      version: number
      processing_state: string
      payload_json: string
      idempotency_key: string
      occurred_at: number
      published_at: number | null
      acknowledged_at: number | null
      attempt_count: number
      last_error: string | null
    }>(
      `SELECT * FROM outbox_events
       WHERE tenant_id = ? AND processing_state IN ('pending', 'publishing')
       ORDER BY occurred_at ASC
       LIMIT ?`,
      tenantId,
      limit,
    )
    .map(mapRow)
}

export function markOutboxPublishing(
  db: ClinicDb,
  tenantId: string,
  outboxId: string,
): void {
  assertClinicSchemaReady(db)
  db.run(
    `UPDATE outbox_events
     SET processing_state = 'publishing', attempt_count = attempt_count + 1
     WHERE tenant_id = ? AND id = ? AND processing_state IN ('pending', 'publishing')`,
    tenantId,
    outboxId,
  )
}

export function markOutboxPublished(
  db: ClinicDb,
  tenantId: string,
  outboxId: string,
  clock: Clock,
): void {
  assertClinicSchemaReady(db)
  db.run(
    `UPDATE outbox_events
     SET processing_state = 'published', published_at = ?, last_error = NULL
     WHERE tenant_id = ? AND id = ? AND processing_state IN ('pending', 'publishing')`,
    clock.nowMs(),
    tenantId,
    outboxId,
  )
}

export function markOutboxPublishFailed(
  db: ClinicDb,
  tenantId: string,
  outboxId: string,
  error: string,
): void {
  assertClinicSchemaReady(db)
  db.run(
    `UPDATE outbox_events
     SET processing_state = 'pending', last_error = ?
     WHERE tenant_id = ? AND id = ? AND processing_state = 'publishing'`,
    error.slice(0, 500),
    tenantId,
    outboxId,
  )
}

/**
 * Consumer devolve resultado ao DO — idempotente por outboxEventId + outcome.
 * Não cria entidade de domínio; só avança estado do outbox.
 */
export function acknowledgeOutboxResult(
  db: ClinicDb,
  result: ConsumerResult,
): OutboxRow {
  assertClinicSchemaReady(db)
  const row = db.get<{
    id: string
    tenant_id: string
    type: string
    aggregate_type: string
    aggregate_id: string
    version: number
    processing_state: string
    payload_json: string
    idempotency_key: string
    occurred_at: number
    published_at: number | null
    acknowledged_at: number | null
    attempt_count: number
    last_error: string | null
  }>(
    `SELECT * FROM outbox_events WHERE tenant_id = ? AND id = ?`,
    result.tenantId,
    result.outboxEventId,
  )
  if (!row) {
    throw new NotFoundError('outbox_not_found', `outbox ${result.outboxEventId}`)
  }
  if (row.idempotency_key !== result.idempotencyKey) {
    throw new ConflictError(
      'outbox_idempotency_mismatch',
      'idempotency_key do resultado não coincide',
    )
  }
  if (row.processing_state === 'acknowledged') {
    return mapRow(row)
  }

  const state =
    result.outcome === 'succeeded'
      ? 'acknowledged'
      : result.outcome === 'failed'
        ? 'failed'
        : 'published'

  let payloadJson = row.payload_json
  if (result.providerRef) {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>
    payload.providerRef = result.providerRef
    payloadJson = JSON.stringify(payload)
  }

  db.run(
    `UPDATE outbox_events
     SET processing_state = ?,
         acknowledged_at = CASE WHEN ? = 'acknowledged' THEN ? ELSE acknowledged_at END,
         last_error = ?,
         payload_json = ?
     WHERE tenant_id = ? AND id = ?`,
    state,
    state,
    result.occurredAt,
    result.errorCode ?? null,
    payloadJson,
    result.tenantId,
    result.outboxEventId,
  )

  const updated = db.get<{
    id: string
    tenant_id: string
    type: string
    aggregate_type: string
    aggregate_id: string
    version: number
    processing_state: string
    payload_json: string
    idempotency_key: string
    occurred_at: number
    published_at: number | null
    acknowledged_at: number | null
    attempt_count: number
    last_error: string | null
  }>(`SELECT * FROM outbox_events WHERE tenant_id = ? AND id = ?`, result.tenantId, result.outboxEventId)
  return mapRow(updated!)
}

export function toEventEnvelope(row: OutboxRow): EventEnvelope {
  return {
    tenantId: row.tenantId,
    eventId: row.id,
    type: row.type,
    entity: { type: row.aggregateType, id: row.aggregateId },
    idempotencyKey: row.idempotencyKey,
    occurredAt: row.occurredAt,
    payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
  }
}

/**
 * Despacho pós-commit: efeitos HTTP/Queues fora da transação SQLite.
 * O publisher é injetado (Queue.send, etc.); falha deixa pending para retentativa.
 */
export type OutboxPublisher = {
  publish(envelope: EventEnvelope): Promise<void>
}

export async function drainOutbox(
  db: ClinicDb,
  tenantId: string,
  publisher: OutboxPublisher,
  clock: Clock,
): Promise<{ published: string[]; failed: string[] }> {
  assertClinicSchemaReady(db)
  const pending = listPendingOutbox(db, tenantId)
  const published: string[] = []
  const failed: string[] = []

  for (const event of pending) {
    markOutboxPublishing(db, tenantId, event.id)
    try {
      await publisher.publish(toEventEnvelope(event))
      markOutboxPublished(db, tenantId, event.id, clock)
      published.push(event.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'publish_failed'
      markOutboxPublishFailed(db, tenantId, event.id, message)
      failed.push(event.id)
    }
  }
  return { published, failed }
}
