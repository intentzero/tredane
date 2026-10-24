import type { Clock } from '../../db/clock'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import type { AppointmentRow } from './types'
import { assertTimeRange } from './validation'

type AppointmentSql = {
  id: string
  tenant_id: string
  service_id: string
  professional_id: string
  room_resource_id: string | null
  starts_at: number
  ends_at: number
  status: string
  contact_label: string | null
  created_at: number
  contact_id?: string | null
  conversation_id?: string | null
  opportunity_id?: string | null
}

function toAppointment(row: AppointmentSql): AppointmentRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serviceId: row.service_id,
    professionalId: row.professional_id,
    roomResourceId: row.room_resource_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status as AppointmentRow['status'],
    contactLabel: row.contact_label,
    createdAt: row.created_at,
    contactId: row.contact_id ?? null,
    conversationId: row.conversation_id ?? null,
    opportunityId: row.opportunity_id ?? null,
  }
}

/** Compromissos confirmados que intersectam [startsAt, endsAt) num recurso. */
export function listAffectedAppointments(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  startsAt: number,
  endsAt: number,
): AppointmentRow[] {
  return db
    .all<AppointmentSql>(
      `SELECT * FROM appointments
       WHERE tenant_id = ?
         AND status = 'confirmed'
         AND starts_at < ?
         AND ends_at > ?
         AND (professional_id = ? OR room_resource_id = ?)
       ORDER BY starts_at, id`,
      tenantId,
      endsAt,
      startsAt,
      resourceId,
      resourceId,
    )
    .map(toAppointment)
}

/**
 * Inserção sintética para testes / seeds — agenda produtiva chega em fatias posteriores.
 * Não cancela nem valida disponibilidade completa (fora de #28).
 */
export function insertSyntheticAppointment(
  db: ClinicDb,
  tenantId: string,
  input: {
    id?: string
    serviceId: string
    professionalId: string
    roomResourceId?: string | null
    startsAt: number
    endsAt: number
    contactLabel?: string | null
    status?: 'confirmed' | 'cancelled'
    /** Vínculos opcionais (#30) — não criam reserva ao mover etapa. */
    contactId?: string | null
    conversationId?: string | null
    opportunityId?: string | null
  },
  clock: Clock,
): AppointmentRow {
  assertTimeRange(input.startsAt, input.endsAt)
  const id = input.id ?? newId('apt')
  const now = clock.nowMs()
  db.run(
    `INSERT INTO appointments (
      id, tenant_id, service_id, professional_id, room_resource_id,
      starts_at, ends_at, status, contact_label, created_at,
      contact_id, conversation_id, opportunity_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    tenantId,
    input.serviceId,
    input.professionalId,
    input.roomResourceId ?? null,
    input.startsAt,
    input.endsAt,
    input.status ?? 'confirmed',
    input.contactLabel ?? null,
    now,
    input.contactId ?? null,
    input.conversationId ?? null,
    input.opportunityId ?? null,
  )
  return toAppointment(
    db.get<AppointmentSql>(
      `SELECT * FROM appointments WHERE tenant_id = ? AND id = ?`,
      tenantId,
      id,
    )!,
  )
}
