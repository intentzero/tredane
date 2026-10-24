import { newId } from '../ids'
import type { ClinicDb } from '../store'
import type { AppointmentEventView } from './booking-types'

type EventSql = {
  id: string
  tenant_id: string
  appointment_id: string
  operation: string
  actor_id: string | null
  reason: string | null
  previous_json: string | null
  new_json: string | null
  occurred_at: number
}

function toEvent(row: EventSql): AppointmentEventView {
  return {
    id: row.id,
    operation: row.operation as AppointmentEventView['operation'],
    actorId: row.actor_id,
    reason: row.reason,
    previousJson: row.previous_json,
    newJson: row.new_json,
    occurredAt: row.occurred_at,
  }
}

export function insertAppointmentEvent(
  db: ClinicDb,
  input: {
    tenantId: string
    appointmentId: string
    operation: 'confirmed' | 'cancelled' | 'rescheduled'
    actorId: string | null
    reason?: string | null
    previous?: Record<string, unknown> | null
    next?: Record<string, unknown> | null
    occurredAt: number
  },
): AppointmentEventView {
  const id = newId('aptevt')
  db.run(
    `INSERT INTO appointment_events (
      id, tenant_id, appointment_id, operation, actor_id, reason,
      previous_json, new_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.tenantId,
    input.appointmentId,
    input.operation,
    input.actorId,
    input.reason ?? null,
    input.previous ? JSON.stringify(input.previous) : null,
    input.next ? JSON.stringify(input.next) : null,
    input.occurredAt,
  )
  return {
    id,
    operation: input.operation,
    actorId: input.actorId,
    reason: input.reason ?? null,
    previousJson: input.previous ? JSON.stringify(input.previous) : null,
    newJson: input.next ? JSON.stringify(input.next) : null,
    occurredAt: input.occurredAt,
  }
}

export function listAppointmentEvents(
  db: ClinicDb,
  tenantId: string,
  appointmentId: string,
): AppointmentEventView[] {
  return db
    .all<EventSql>(
      `SELECT * FROM appointment_events
       WHERE tenant_id = ? AND appointment_id = ?
       ORDER BY occurred_at, id`,
      tenantId,
      appointmentId,
    )
    .map(toEvent)
}
