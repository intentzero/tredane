import type { Clock } from '../../db/clock'
import { NotFoundError, ValidationError } from '../errors'
import { newId } from '../ids'
import { resourceHasHistory } from './resource-history'
import type { ClinicDb } from '../store'
import {
  CLINIC_SCOPE_ID,
  type ResourceRow,
  type RoomAttendanceMode,
  type UpsertResourceInput,
} from './types'
import { assertNonEmptyName, assertResourceKind } from './validation'

type ResourceSql = {
  id: string
  tenant_id: string
  kind: string
  name: string
  category: string | null
  active: number
  capacity?: number | null
  shared_space_notice?: string | null
  hours_mode?: string | null
  home_room_id?: string | null
  attendance_mode?: string | null
  same_sex_in_slot?: number | null
  created_at: number
  updated_at: number
}

function countFutureAppointments(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  kind: string,
  nowMs: number,
): number {
  if (kind === 'professional') {
    const row = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM appointments
       WHERE tenant_id = ? AND professional_id = ?
         AND status = 'confirmed' AND starts_at >= ?`,
      tenantId,
      resourceId,
      nowMs,
    )
    return row?.n ?? 0
  }
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointments
     WHERE tenant_id = ? AND room_resource_id = ?
       AND status = 'confirmed' AND starts_at >= ?`,
    tenantId,
    resourceId,
    nowMs,
  )
  return row?.n ?? 0
}

function toAttendanceMode(value: string | null | undefined): RoomAttendanceMode {
  return value === 'uma_para_todas' ? 'uma_para_todas' : 'cada_profissional'
}

function toResourceRow(
  db: ClinicDb,
  row: ResourceSql,
  nowMs: number,
): ResourceRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind as ResourceRow['kind'],
    name: row.name,
    category: row.category,
    active: row.active === 1,
    capacity: row.kind === 'room' ? Math.max(1, row.capacity ?? 1) : 1,
    sharedSpaceNotice: row.kind === 'room' ? row.shared_space_notice ?? null : null,
    hoursMode: row.kind === 'professional' && row.hours_mode === 'clinic' ? 'clinic' : 'own',
    homeRoomId: row.kind === 'professional' ? row.home_room_id ?? null : null,
    attendanceMode:
      row.kind === 'room' ? toAttendanceMode(row.attendance_mode) : 'cada_profissional',
    sameSexInSlot:
      row.kind === 'room'
      && Math.max(1, row.capacity ?? 1) > 1
      && row.same_sex_in_slot === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    futureAppointmentCount: countFutureAppointments(
      db,
      row.tenant_id,
      row.id,
      row.kind,
      nowMs,
    ),
    hasAppointmentHistory: resourceHasHistory(db, row.tenant_id, row.id),
  }
}

export function listResources(db: ClinicDb, tenantId: string, clock: Clock): ResourceRow[] {
  const now = clock.nowMs()
  const rows = db.all<ResourceSql>(
    `SELECT * FROM resources WHERE tenant_id = ?
     ORDER BY kind, name COLLATE NOCASE, id`,
    tenantId,
  )
  return rows.map((r) => toResourceRow(db, r, now))
}

export function getResource(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  clock: Clock,
): ResourceRow | null {
  const row = db.get<ResourceSql>(
    `SELECT * FROM resources WHERE tenant_id = ? AND id = ?`,
    tenantId,
    resourceId,
  )
  return row ? toResourceRow(db, row, clock.nowMs()) : null
}

export function upsertResource(
  db: ClinicDb,
  tenantId: string,
  input: UpsertResourceInput,
  clock: Clock,
): ResourceRow {
  assertResourceKind(input.kind)
  const name = assertNonEmptyName(input.name)
  let category: string | null = null
  if (input.kind === 'professional') {
    if (input.category) {
      throw new ValidationError(
        'invalid_category',
        'profissional não tem categoria de sala',
      )
    }
  } else {
    category = input.category?.trim() ? assertNonEmptyName(input.category, 'category') : null
  }

  const now = clock.nowMs()
  const active = input.active === false ? 0 : 1
  const capacityIn = parseCapacity(input)
  const noticeIn = parseNotice(input)
  const hoursIn = parseHoursMode(input)
  const homeRoomIn = parseHomeRoomId(db, tenantId, input)
  const attendanceIn = parseAttendanceMode(input)
  const sameSexIn = parseSameSexInSlot(input)

  if (input.id) {
    const existing = getResource(db, tenantId, input.id, clock)
    if (!existing) {
      throw new NotFoundError('resource_not_found', `recurso ${input.id} não encontrado`)
    }
    if (existing.kind !== input.kind) {
      throw new ValidationError(
        'resource_kind_immutable',
        'tipo do recurso não pode mudar após criação',
      )
    }
    const cap = capacityIn ?? existing.capacity
    const attendance =
      input.kind === 'room'
        ? cap <= 1
          ? 'cada_profissional'
          : (attendanceIn ?? existing.attendanceMode)
        : 'cada_profissional'
    const sameSex =
      input.kind === 'room'
        ? cap <= 1
          ? 0
          : sameSexIn === undefined
            ? existing.sameSexInSlot
              ? 1
              : 0
            : sameSexIn
              ? 1
              : 0
        : 0
    db.run(
      `UPDATE resources SET name = ?, category = ?, active = ?, capacity = ?,
         shared_space_notice = ?, hours_mode = ?, home_room_id = ?, attendance_mode = ?,
         same_sex_in_slot = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      name,
      category,
      active,
      cap,
      noticeIn === undefined ? existing.sharedSpaceNotice : noticeIn,
      input.kind === 'professional' ? (hoursIn ?? existing.hoursMode) : 'own',
      input.kind === 'professional'
        ? (homeRoomIn === undefined ? existing.homeRoomId : homeRoomIn)
        : null,
      attendance,
      sameSex,
      now,
      tenantId,
      input.id,
    )
    return getResource(db, tenantId, input.id, clock)!
  }

  const id = newId(input.kind === 'professional' ? 'pro' : 'res')
  const createCap = capacityIn ?? 1
  db.run(
    `INSERT INTO resources (
      id, tenant_id, kind, name, category, active, capacity, shared_space_notice,
      hours_mode, home_room_id, attendance_mode, same_sex_in_slot, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    tenantId,
    input.kind,
    name,
    category,
    active,
    createCap,
    noticeIn ?? null,
    input.kind === 'professional' ? (hoursIn ?? defaultHoursMode(db, tenantId)) : 'own',
    input.kind === 'professional' ? (homeRoomIn ?? null) : null,
    input.kind === 'room'
      ? createCap <= 1
        ? 'cada_profissional'
        : (attendanceIn ?? 'cada_profissional')
      : 'cada_profissional',
    input.kind === 'room' && createCap > 1 && sameSexIn ? 1 : 0,
    now,
    now,
  )
  return getResource(db, tenantId, id, clock)!
}

export function setResourceActive(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  active: boolean,
  clock: Clock,
): ResourceRow {
  const existing = getResource(db, tenantId, resourceId, clock)
  if (!existing) {
    throw new NotFoundError('resource_not_found', `recurso ${resourceId} não encontrado`)
  }
  db.run(
    `UPDATE resources SET active = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,
    active ? 1 : 0,
    clock.nowMs(),
    tenantId,
    resourceId,
  )
  return getResource(db, tenantId, resourceId, clock)!
}

/** DEC-082: a categoria deixou de escolher as salas do serviço. */
export function servicesLeftWithoutCategoryResource(
  _db: ClinicDb,
  _tenantId: string,
  _category: string,
  _excludingResourceId?: string,
): string[] {
  return []
}

export const MAX_ROOM_CAPACITY = 50
export const MAX_SHARED_NOTICE_LENGTH = 300

/** Capacidade só existe na sala (card t1892s7600: equipamento não tem). */
function parseCapacity(input: UpsertResourceInput): number | undefined {
  if (input.capacity === undefined || input.capacity === null) return undefined
  if (input.kind !== 'room') {
    if (input.capacity === 1) return 1
    throw new ValidationError('capacity_room_only', 'Só a sala atende várias pessoas ao mesmo tempo.')
  }
  const n = input.capacity
  if (!Number.isInteger(n) || n < 1 || n > MAX_ROOM_CAPACITY) {
    throw new ValidationError(
      'invalid_capacity',
      `A sala atende de 1 a ${MAX_ROOM_CAPACITY} pessoas ao mesmo tempo.`,
    )
  }
  return n
}

function parseNotice(input: UpsertResourceInput): string | null | undefined {
  if (input.sharedSpaceNotice === undefined) return undefined
  if (input.sharedSpaceNotice === null) return null
  if (input.kind !== 'room') return null
  const t = String(input.sharedSpaceNotice).trim()
  if (!t) return null
  if (t.length > MAX_SHARED_NOTICE_LENGTH) {
    throw new ValidationError(
      'invalid_shared_notice',
      `A frase pode ter até ${MAX_SHARED_NOTICE_LENGTH} caracteres.`,
    )
  }
  return t
}

function parseHoursMode(input: UpsertResourceInput): 'clinic' | 'own' | undefined {
  if (input.hoursMode === undefined) return undefined
  if (input.kind !== 'professional') {
    throw new ValidationError('hours_mode_professional_only', 'Só a profissional tem horário.')
  }
  if (input.hoursMode !== 'clinic' && input.hoursMode !== 'own') {
    throw new ValidationError('invalid_hours_mode', 'Horário: «clinic» ou «own».')
  }
  return input.hoursMode
}

/** Nova profissional segue o horário da clínica quando ele já existe. */
function defaultHoursMode(db: ClinicDb, tenantId: string): 'clinic' | 'own' {
  const n = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM weekly_windows WHERE tenant_id = ? AND resource_id = ?`,
    tenantId,
    CLINIC_SCOPE_ID,
  )?.n ?? 0
  return n > 0 ? 'clinic' : 'own'
}

function parseHomeRoomId(
  db: ClinicDb,
  tenantId: string,
  input: UpsertResourceInput,
): string | null | undefined {
  if (input.homeRoomId === undefined) return undefined
  if (input.kind !== 'professional') {
    if (input.homeRoomId == null) return null
    throw new ValidationError('home_room_professional_only', 'Só a profissional tem sala.')
  }
  if (input.homeRoomId === null || input.homeRoomId === '') return null
  const room = db.get<{ kind: string; active: number }>(
    `SELECT kind, active FROM resources WHERE tenant_id = ? AND id = ?`,
    tenantId,
    input.homeRoomId,
  )
  if (!room || room.kind !== 'room' || room.active !== 1) {
    throw new ValidationError(
      'invalid_home_room',
      'A sala da profissional tem de ser uma sala activa desta clínica.',
      { homeRoomId: input.homeRoomId },
    )
  }
  return input.homeRoomId
}

function parseAttendanceMode(input: UpsertResourceInput): RoomAttendanceMode | undefined {
  if (input.attendanceMode === undefined) return undefined
  if (input.kind !== 'room') {
    throw new ValidationError('attendance_mode_room_only', 'O modo de atendimento é da sala.')
  }
  if (
    input.attendanceMode !== 'cada_profissional'
    && input.attendanceMode !== 'uma_para_todas'
  ) {
    throw new ValidationError(
      'invalid_attendance_mode',
      'Modo: cada profissional com a sua cliente, ou uma profissional para todas.',
    )
  }
  return input.attendanceMode
}

function parseSameSexInSlot(input: UpsertResourceInput): boolean | undefined {
  if (input.sameSexInSlot === undefined) return undefined
  if (input.kind !== 'room') {
    throw new ValidationError(
      'same_sex_room_only',
      '«Mesmo sexo neste horário» é só da sala.',
    )
  }
  return Boolean(input.sameSexInSlot)
}
