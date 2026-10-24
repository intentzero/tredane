import type { ClinicDb } from '../store'

export type PixLifecycleEventType =
  | 'charge.expired'
  | 'charge.cancelled'
  | 'refund.updated'

export type PixLifecycleOutcome =
  | 'expired'
  | 'cancelled'
  | 'refund_requested'
  | 'refunded'
  | 'refund_failed'
  | 'ignored_duplicate'
  | 'ignored_late_paid_trace'
  | 'ignored_state'
  | 'rejected'

type EvtSql = {
  tenant_id: string
  event_id: string
  charge_id: string | null
  event_type: string
  outcome: string
  detail_json: string | null
  processed_at: number
}

export type PixLifecycleEventRow = {
  eventId: string
  chargeId: string | null
  eventType: PixLifecycleEventType
  outcome: PixLifecycleOutcome
  detailJson: string | null
  processedAt: number
}

export function findPixLifecycleEvent(
  db: ClinicDb,
  tenantId: string,
  eventId: string,
): PixLifecycleEventRow | null {
  const row = db.get<EvtSql>(
    `SELECT * FROM pix_lifecycle_events WHERE tenant_id = ? AND event_id = ?`,
    tenantId,
    eventId,
  )
  if (!row) return null
  return {
    eventId: row.event_id,
    chargeId: row.charge_id,
    eventType: row.event_type as PixLifecycleEventType,
    outcome: row.outcome as PixLifecycleOutcome,
    detailJson: row.detail_json,
    processedAt: row.processed_at,
  }
}

export function savePixLifecycleEvent(
  db: ClinicDb,
  input: {
    tenantId: string
    eventId: string
    chargeId?: string | null
    eventType: PixLifecycleEventType
    outcome: PixLifecycleOutcome
    detail?: Record<string, unknown> | null
    processedAt: number
  },
): void {
  db.run(
    `INSERT OR IGNORE INTO pix_lifecycle_events (
      tenant_id, event_id, charge_id, event_type, outcome, detail_json, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.tenantId,
    input.eventId,
    input.chargeId ?? null,
    input.eventType,
    input.outcome,
    input.detail ? JSON.stringify(input.detail) : null,
    input.processedAt,
  )
}
