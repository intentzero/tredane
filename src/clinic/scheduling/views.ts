/**
 * Visões dia/semana da agenda (#36 / REQ-034 / TEL-04 / DEC-040).
 */
import type { Clock } from '../../db/clock'
import { AI_AUTOBOOK_ACTOR } from '../constants'
import { getResource } from '../config/resources'
import { getService } from '../config/services'
import { ensureClinicSettings } from '../config/settings'
import { occupiedMinutes } from '../config/validation'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import type { AgendaViewInput, AgendaViewResult, AppointmentListItem } from './booking-types'
import { HOLD_SELECT, mapHold, type HoldSql, type ScheduleHoldView } from './hold-rows'
import {
  clinicDayBounds,
  clinicDayOfWeek,
  formatCivilDate,
  parseCivilDate,
} from './timezone'

type AptSql = {
  id: string
  service_id: string
  professional_id: string
  room_resource_id: string | null
  starts_at: number
  ends_at: number
  status: string
  contact_label: string | null
  contact_id: string | null
  conversation_id: string | null
  opportunity_id: string | null
  version: number
  change_reason: string | null
  occupies_until: number | null
  default_duration_minutes: number | null
  applied_duration_minutes: number | null
  confirmed_by: string | null
}

function addCivilDays(date: string, days: number): string {
  const { year, month, day } = parseCivilDate(date)
  const utc = Date.UTC(year, month - 1, day + days)
  const d = new Date(utc)
  return formatCivilDate({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  })
}

/** Segunda-feira civil da semana que contém `date` (DEC-040). */
function weekStartCivil(timezone: string, date: string): string {
  const { dayStartsAt } = clinicDayBounds(timezone, date)
  const dow = clinicDayOfWeek(timezone, dayStartsAt) // 1=seg … 7=dom
  const offset = 1 - dow
  return addCivilDays(date, offset)
}

export function queryAgendaViewOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: AgendaViewInput,
  clock: Clock,
): AgendaViewResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const settings = ensureClinicSettings(db, meta.tenantId, clock)
  const timezone = settings.timezone

  if (input.view !== 'day' && input.view !== 'week') {
    throw new ValidationError('invalid_view', 'view deve ser day ou week')
  }
  parseCivilDate(input.date)

  let rangeStartsAt: number
  let rangeEndsAt: number
  if (input.view === 'day') {
    const bounds = clinicDayBounds(timezone, input.date)
    rangeStartsAt = bounds.dayStartsAt
    rangeEndsAt = bounds.dayEndsAt
  } else {
    const weekStart = weekStartCivil(timezone, input.date)
    const weekEnd = addCivilDays(weekStart, 7)
    rangeStartsAt = clinicDayBounds(timezone, weekStart).dayStartsAt
    rangeEndsAt = clinicDayBounds(timezone, weekEnd).dayStartsAt
  }

  const includeCancelled = input.includeCancelled === true
  const rows = db.all<AptSql>(
    `SELECT id, service_id, professional_id, room_resource_id,
            starts_at, ends_at, status, contact_label,
            contact_id, conversation_id, opportunity_id,
            version, change_reason, occupies_until,
            default_duration_minutes, applied_duration_minutes, confirmed_by
     FROM appointments
     WHERE tenant_id = ?
       AND starts_at < ?
       AND ends_at > ?
       AND (? = 1 OR status = 'confirmed')
     ORDER BY starts_at, id`,
    meta.tenantId,
    rangeEndsAt,
    rangeStartsAt,
    includeCancelled ? 1 : 0,
  )

  const appointments: AppointmentListItem[] = []
  for (const row of rows) {
    if (
      input.professionalId
      && input.professionalId !== 'any'
      && row.professional_id !== input.professionalId
    ) {
      continue
    }
    if (
      input.roomResourceId
      && row.room_resource_id !== input.roomResourceId
    ) {
      continue
    }
    const svc = getService(db, meta.tenantId, row.service_id)
    const pro = getResource(db, meta.tenantId, row.professional_id, clock)
    const room = row.room_resource_id
      ? getResource(db, meta.tenantId, row.room_resource_id, clock)
      : null
    const occupiesUntil =
      row.occupies_until
      ?? (svc
        ? row.starts_at
          + occupiedMinutes(svc.durationMinutes, svc.bufferMinutes) * 60_000
        : row.ends_at)
    appointments.push({
      id: row.id,
      serviceId: row.service_id,
      serviceName: svc?.name ?? row.service_id,
      professionalId: row.professional_id,
      professionalName: pro?.name ?? row.professional_id,
      roomResourceId: row.room_resource_id,
      roomResourceName: room?.name ?? null,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      occupiesUntil,
      status: row.status as 'confirmed' | 'cancelled',
      contactLabel: row.contact_label,
      contactId: row.contact_id,
      conversationId: row.conversation_id,
      opportunityId: row.opportunity_id,
      version: row.version ?? 1,
      changeReason: row.change_reason,
      durationAdjusted:
        row.applied_duration_minutes != null
        && row.default_duration_minutes != null
        && row.applied_duration_minutes !== row.default_duration_minutes,
      bookedByAi: row.confirmed_by === AI_AUTOBOOK_ACTOR,
    })
  }

  return {
    tenantId: meta.tenantId,
    timezone,
    view: input.view,
    date: input.date,
    rangeStartsAt,
    rangeEndsAt,
    asOf: clock.nowMs(),
    appointments,
    holds: listAgendaHolds(db, meta.tenantId, rangeStartsAt, rangeEndsAt, input.professionalId ?? null),
  }
}

function listAgendaHolds(
  db: ClinicDb,
  tenantId: string,
  rangeStartsAt: number,
  rangeEndsAt: number,
  professionalId: string | null,
): ScheduleHoldView[] {
  const rows = db.all<HoldSql>(
    `${HOLD_SELECT}
     WHERE h.tenant_id = ? AND h.status = 'active'
       AND h.window_starts_at < ? AND h.window_ends_at > ?
     ORDER BY h.window_starts_at, h.id`,
    tenantId,
    rangeEndsAt,
    rangeStartsAt,
  )
  return rows
    .map(mapHold)
    .filter((h) => !professionalId || professionalId === 'any' || h.professionalId === professionalId)
}
