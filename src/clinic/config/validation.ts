import {
  BLOCK_REASONS,
  DEFAULT_CLINIC_TIMEZONE,
  RESOURCE_KINDS,
  SCHEDULE_GRID_MINUTES,
  type BlockReason,
  type ResourceKind,
} from '../constants'
import { ValidationError } from '../errors'
import type { RoomRequirement } from './types'

export function assertMultipleOfGrid(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(
      'invalid_schedule_grid',
      `${field} deve ser inteiro ≥ 0 em múltiplos de ${SCHEDULE_GRID_MINUTES}`,
      { field, value },
    )
  }
  if (value % SCHEDULE_GRID_MINUTES !== 0) {
    throw new ValidationError(
      'invalid_schedule_grid',
      `${field} deve ser múltiplo de ${SCHEDULE_GRID_MINUTES} min`,
      { field, value },
    )
  }
}

export function assertPositiveDuration(minutes: number): void {
  assertMultipleOfGrid(minutes, 'durationMinutes')
  if (minutes < SCHEDULE_GRID_MINUTES) {
    throw new ValidationError(
      'invalid_duration',
      `duração mínima ${SCHEDULE_GRID_MINUTES} min`,
      { durationMinutes: minutes },
    )
  }
}

export function assertBufferMinutes(minutes: number): void {
  assertMultipleOfGrid(minutes, 'bufferMinutes')
}

export function assertDayOfWeek(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 7) {
    throw new ValidationError(
      'invalid_day_of_week',
      'dayOfWeek deve ser 1 (segunda) a 7 (domingo)',
      { dayOfWeek: day },
    )
  }
}

export function assertWindowRange(startMinute: number, endMinute: number): void {
  assertMultipleOfGrid(startMinute, 'startMinute')
  assertMultipleOfGrid(endMinute, 'endMinute')
  if (startMinute >= endMinute) {
    throw new ValidationError(
      'invalid_window_range',
      'startMinute deve ser menor que endMinute',
      { startMinute, endMinute },
    )
  }
  if (endMinute > 24 * 60) {
    throw new ValidationError(
      'invalid_window_range',
      'endMinute não pode ultrapassar 24:00',
      { endMinute },
    )
  }
}

export function assertBlockReason(reason: string): asserts reason is BlockReason {
  if (!(BLOCK_REASONS as readonly string[]).includes(reason)) {
    throw new ValidationError('invalid_block_reason', `motivo inválido: ${reason}`, {
      reason,
      allowed: BLOCK_REASONS,
    })
  }
}

export function assertResourceKind(kind: string): asserts kind is ResourceKind {
  if (!(RESOURCE_KINDS as readonly string[]).includes(kind)) {
    throw new ValidationError('invalid_resource_kind', `tipo inválido: ${kind}`, {
      kind,
      allowed: RESOURCE_KINDS,
    })
  }
}

export function assertTimezone(timezone: string): string {
  const tz = timezone.trim()
  if (!tz) {
    throw new ValidationError('invalid_timezone', 'timezone obrigatório')
  }
  try {
    // Valida IANA via Intl — lança RangeError se inválido.
    Intl.DateTimeFormat(undefined, { timeZone: tz })
  } catch {
    throw new ValidationError('invalid_timezone', `timezone IANA inválido: ${tz}`, {
      timezone: tz,
    })
  }
  return tz
}

export function normalizeTimezone(timezone?: string | null): string {
  if (!timezone) return DEFAULT_CLINIC_TIMEZONE
  return assertTimezone(timezone)
}

export function assertNonEmptyName(name: string, field = 'name'): string {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new ValidationError('invalid_name', `${field} obrigatório`, { field })
  }
  if (trimmed.length > 120) {
    throw new ValidationError('invalid_name', `${field} demasiado longo`, {
      field,
      max: 120,
    })
  }
  return trimmed
}

export function normalizeRoomRequirement(
  input: RoomRequirement | undefined,
): RoomRequirement {
  if (!input || input.mode === 'none') return { mode: 'none' }
  if (input.mode === 'category') {
    const category = assertNonEmptyName(input.category, 'category')
    return { mode: 'category', category }
  }
  if (input.mode === 'resource') {
    if (!input.resourceId?.trim()) {
      throw new ValidationError(
        'invalid_room_requirement',
        'resourceId obrigatório no modo resource',
      )
    }
    return { mode: 'resource', resourceId: input.resourceId.trim() }
  }
  throw new ValidationError('invalid_room_requirement', 'modo de recurso inválido')
}

export function assertTimeRange(startsAt: number, endsAt: number): void {
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
    throw new ValidationError('invalid_time_range', 'startsAt/endsAt inválidos')
  }
  if (startsAt >= endsAt) {
    throw new ValidationError(
      'invalid_time_range',
      'startsAt deve ser anterior a endsAt',
      { startsAt, endsAt },
    )
  }
}

/** Ocupação total na agenda = duração + intervalo (DEC-008). */
export function occupiedMinutes(durationMinutes: number, bufferMinutes: number): number {
  return durationMinutes + bufferMinutes
}
