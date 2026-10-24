import { SCHEDULE_GRID_MINUTES } from '../constants'
import type { ClinicDb } from '../store'
import { getService } from '../config/services'
import { occupiedMinutes } from '../config/validation'
import type { WeeklyWindowRow } from '../config/types'
import type { UnavailabilityReason } from './types'

export type Interval = { startsAt: number; endsAt: number }

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt
}

/** Janelas semanais cobrem [startMinute, startMinute + occupiedMinutes]? */
export function weeklyCovers(
  windows: WeeklyWindowRow[],
  dayOfWeek: number,
  startMinute: number,
  occupiedMins: number,
): boolean {
  const endMinute = startMinute + occupiedMins
  if (endMinute > 24 * 60) return false
  return windows.some(
    (w) =>
      w.dayOfWeek === dayOfWeek
      && w.startMinute <= startMinute
      && w.endMinute >= endMinute,
  )
}

type BlockSql = { starts_at: number; ends_at: number; id: string }

export function listBlocksOverlapping(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  range: Interval,
): BlockSql[] {
  return db.all<BlockSql>(
    `SELECT id, starts_at, ends_at FROM resource_blocks
     WHERE tenant_id = ? AND resource_id = ?
       AND starts_at < ? AND ends_at > ?
     ORDER BY starts_at, id`,
    tenantId,
    resourceId,
    range.endsAt,
    range.startsAt,
  )
}

type AptSql = {
  id: string
  service_id: string
  professional_id: string
  room_resource_id: string | null
  starts_at: number
  ends_at: number
}

/**
 * Ocupação efetiva de um compromisso confirmado = duração + buffer do serviço
 * (DEC-008). Fallback a ends_at se o serviço sumiu.
 */
export function appointmentOccupiesUntil(
  db: ClinicDb,
  tenantId: string,
  apt: AptSql,
): number {
  const svc = getService(db, tenantId, apt.service_id)
  if (svc) {
    return apt.starts_at + occupiedMinutes(svc.durationMinutes, svc.bufferMinutes) * 60_000
  }
  return apt.ends_at
}

export function listConfirmedOccupyingResource(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  range: Interval,
): Array<{ id: string; startsAt: number; occupiesUntil: number }> {
  const rows = db.all<AptSql>(
    `SELECT id, service_id, professional_id, room_resource_id, starts_at, ends_at
     FROM appointments
     WHERE tenant_id = ?
       AND status = 'confirmed'
       AND (professional_id = ? OR room_resource_id = ?)
     ORDER BY starts_at, id`,
    tenantId,
    resourceId,
    resourceId,
  )
  const out: Array<{ id: string; startsAt: number; occupiesUntil: number }> = []
  for (const row of rows) {
    const occupiesUntil = appointmentOccupiesUntil(db, tenantId, row)
    if (intervalsOverlap(range, { startsAt: row.starts_at, endsAt: occupiesUntil })) {
      out.push({ id: row.id, startsAt: row.starts_at, occupiesUntil })
    }
  }
  return out
}

export function gridStartMinutes(occupiedMins: number): number[] {
  const last = 24 * 60 - occupiedMins
  const starts: number[] = []
  for (let m = 0; m <= last; m += SCHEDULE_GRID_MINUTES) {
    starts.push(m)
  }
  return starts
}

export type ResourceBusyReason =
  | Extract<
      UnavailabilityReason,
      'outside_weekly_hours' | 'resource_block' | 'appointment_conflict' | 'crosses_day_boundary'
    >

/**
 * Verifica se um recurso está livre no intervalo de ocupação.
 * Não cria nem altera dados.
 */
export function resourceBusyReasons(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  windows: WeeklyWindowRow[],
  dayOfWeek: number,
  startMinute: number,
  occupiedMins: number,
  range: Interval,
  dayEndsAt: number,
): ResourceBusyReason[] {
  const reasons: ResourceBusyReason[] = []
  if (range.endsAt > dayEndsAt) {
    reasons.push('crosses_day_boundary')
  }
  if (!weeklyCovers(windows, dayOfWeek, startMinute, occupiedMins)) {
    reasons.push('outside_weekly_hours')
  }
  if (listBlocksOverlapping(db, tenantId, resourceId, range).length > 0) {
    reasons.push('resource_block')
  }
  if (listConfirmedOccupyingResource(db, tenantId, resourceId, range).length > 0) {
    reasons.push('appointment_conflict')
  }
  return reasons
}
