import type { Clock } from '../db/clock'
import { newId } from '../clinic/ids'
import type { ClinicDb } from '../clinic/store'
import { ensureRealtimeFence, readFence } from './fence'

export type RealtimeEventRow = {
  seq: number
  tenantId: string
  eventId: string
  type: string
  entityType: string
  entityId: string
  payload: Record<string, unknown>
  occurredAt: number
}

export type AppendRealtimeEventInput = {
  tenantId: string
  type: string
  entityType: string
  entityId: string
  payload: Record<string, unknown>
  /** Se omitido, gera event_id estável aleatório. */
  eventId?: string
  occurredAt?: number
}

/**
 * Persiste evento versionado (seq monotónico por clínica) após commit de domínio.
 * Idempotente por (tenant_id, event_id).
 */
export function appendRealtimeEvent(
  db: ClinicDb,
  input: AppendRealtimeEventInput,
  clock: Clock,
): RealtimeEventRow {
  ensureRealtimeFence(db, clock)
  const eventId = input.eventId ?? newId('evt')
  const occurredAt = input.occurredAt ?? clock.nowMs()

  const existing = db.get<{
    seq: number
    tenant_id: string
    event_id: string
    type: string
    entity_type: string
    entity_id: string
    payload_json: string
    occurred_at: number
  }>(
    `SELECT seq, tenant_id, event_id, type, entity_type, entity_id, payload_json, occurred_at
     FROM realtime_events WHERE tenant_id = ? AND event_id = ?`,
    input.tenantId,
    eventId,
  )
  if (existing) {
    return mapEvent(existing)
  }

  const fence = readFence(db)!
  const seq = fence.lastEventSeq + 1
  db.run(
    `INSERT INTO realtime_events
      (seq, tenant_id, event_id, type, entity_type, entity_id, payload_json, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    seq,
    input.tenantId,
    eventId,
    input.type,
    input.entityType,
    input.entityId,
    JSON.stringify(input.payload),
    occurredAt,
  )
  db.run(
    `UPDATE realtime_fence SET last_event_seq = ?, updated_at = ? WHERE id = 1`,
    seq,
    clock.nowMs(),
  )

  return {
    seq,
    tenantId: input.tenantId,
    eventId,
    type: input.type,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: input.payload,
    occurredAt,
  }
}

export function listRealtimeEventsAfter(
  db: ClinicDb,
  tenantId: string,
  afterSeq: number,
  limit = 200,
): RealtimeEventRow[] {
  const rows = db.all<{
    seq: number
    tenant_id: string
    event_id: string
    type: string
    entity_type: string
    entity_id: string
    payload_json: string
    occurred_at: number
  }>(
    `SELECT seq, tenant_id, event_id, type, entity_type, entity_id, payload_json, occurred_at
     FROM realtime_events
     WHERE tenant_id = ? AND seq > ?
     ORDER BY seq ASC
     LIMIT ?`,
    tenantId,
    afterSeq,
    limit,
  )
  return rows.map(mapEvent)
}

export function getLastEventSeq(db: ClinicDb): number {
  return readFence(db)?.lastEventSeq ?? 0
}

/**
 * Mescla eventos WS + catch-up HTTP sem duplicar por eventId (REQ-041).
 */
export function mergeEventsById(
  existing: readonly RealtimeEventRow[],
  incoming: readonly RealtimeEventRow[],
): RealtimeEventRow[] {
  const byId = new Map<string, RealtimeEventRow>()
  for (const e of existing) byId.set(e.eventId, e)
  for (const e of incoming) {
    if (!byId.has(e.eventId)) byId.set(e.eventId, e)
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq)
}

function mapEvent(row: {
  seq: number
  tenant_id: string
  event_id: string
  type: string
  entity_type: string
  entity_id: string
  payload_json: string
  occurred_at: number
}): RealtimeEventRow {
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(row.payload_json) as Record<string, unknown>
  } catch {
    payload = {}
  }
  return {
    seq: row.seq,
    tenantId: row.tenant_id,
    eventId: row.event_id,
    type: row.type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload,
    occurredAt: row.occurred_at,
  }
}
