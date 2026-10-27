import type { Clock } from '../../db/clock'
import { NotFoundError, ValidationError } from '../errors'
import { newId } from '../ids'
import { resourceHasHistory } from './resource-history'
import type { ClinicDb } from '../store'
import type { ResourceRow, UpsertResourceInput } from './types'
import { assertNonEmptyName, assertResourceKind } from './validation'

type ResourceSql = {
  id: string
  tenant_id: string
  kind: string
  name: string
  category: string | null
  active: number
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
    db.run(
      `UPDATE resources SET name = ?, category = ?, active = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      name,
      category,
      active,
      now,
      tenantId,
      input.id,
    )
    return getResource(db, tenantId, input.id, clock)!
  }

  const id = newId(input.kind === 'professional' ? 'pro' : 'res')
  db.run(
    `INSERT INTO resources (
      id, tenant_id, kind, name, category, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    tenantId,
    input.kind,
    name,
    category,
    active,
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

/** Serviços activos que exigem a categoria e ficariam sem recurso activo. */
export function servicesLeftWithoutCategoryResource(
  db: ClinicDb,
  tenantId: string,
  category: string,
  excludingResourceId?: string,
): string[] {
  const remaining = excludingResourceId
    ? db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM resources
         WHERE tenant_id = ? AND active = 1 AND category = ?
           AND kind IN ('room', 'equipment') AND id != ?`,
        tenantId,
        category,
        excludingResourceId,
      )
    : db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM resources
         WHERE tenant_id = ? AND active = 1 AND category = ?
           AND kind IN ('room', 'equipment')`,
        tenantId,
        category,
      )
  if ((remaining?.n ?? 0) > 0) return []

  return db
    .all<{ service_id: string }>(
      `SELECT service_id FROM service_room_requirements
       WHERE tenant_id = ? AND mode = 'category' AND category = ?`,
      tenantId,
      category,
    )
    .map((r) => r.service_id)
}
