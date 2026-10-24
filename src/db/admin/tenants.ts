import type { Clock } from '../clock'
import type { TenantStatus } from '../schema'
import { writeAudit } from './audit'
import { ConflictError, NotFoundError } from './errors'
import { assertAdminSchemaReady } from './gate'
import { newId } from './ids'
import type { AdminDb } from './store'

export type TenantRow = {
  id: string
  name: string
  timezone: string
  status: TenantStatus
  createdAt: number
  updatedAt: number
  suspendedAt: number | null
  pendingDeletionAt: number | null
}

function mapTenant(row: {
  id: string
  name: string
  timezone: string
  status: string
  created_at: number
  updated_at: number
  suspended_at: number | null
  pending_deletion_at: number | null
}): TenantRow {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    status: row.status as TenantStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    suspendedAt: row.suspended_at,
    pendingDeletionAt: row.pending_deletion_at,
  }
}

export function getTenant(db: AdminDb, tenantId: string): TenantRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<{
    id: string
    name: string
    timezone: string
    status: string
    created_at: number
    updated_at: number
    suspended_at: number | null
    pending_deletion_at: number | null
  }>(
    `SELECT id, name, timezone, status, created_at, updated_at, suspended_at, pending_deletion_at
     FROM tenants WHERE id = ?`,
    tenantId,
  )
  return row ? mapTenant(row) : undefined
}

export function createTenant(
  db: AdminDb,
  clock: Clock,
  input: {
    id?: string
    name: string
    timezone?: string
    actorClerkUserId: string
  },
): TenantRow {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const id = input.id ?? newId('tenant')
  const timezone = input.timezone ?? 'America/Sao_Paulo'

  return db.immediate(() => {
    db.run(
      `INSERT INTO tenants (id, name, timezone, status, created_at, updated_at, suspended_at, pending_deletion_at)
       VALUES (?, ?, ?, 'active', ?, ?, NULL, NULL)`,
      id,
      input.name,
      timezone,
      now,
      now,
    )
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      tenantId: id,
      action: 'tenant.create',
      objectType: 'tenant',
      objectId: id,
      outcome: 'success',
      metadata: { name: input.name },
    })
    return getTenant(db, id)!
  })
}

function transitionTenantStatus(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    actorClerkUserId: string
    from: TenantStatus[]
    to: TenantStatus
    action: string
    extraSet: string
    extraParams: Array<string | number | null>
  },
): TenantRow {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  return db.immediate(() => {
    const placeholders = input.from.map(() => '?').join(', ')
    const result = db.run(
      `UPDATE tenants
       SET status = ?, updated_at = ?, ${input.extraSet}
       WHERE id = ? AND status IN (${placeholders})`,
      input.to,
      now,
      ...input.extraParams,
      input.tenantId,
      ...input.from,
    )
    if (result.changes !== 1) {
      const current = getTenant(db, input.tenantId)
      if (!current) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
      throw new ConflictError(
        'tenant_status_conflict',
        `Transição ${current.status} → ${input.to} inválida`,
      )
    }
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      tenantId: input.tenantId,
      action: input.action,
      objectType: 'tenant',
      objectId: input.tenantId,
      outcome: 'success',
      metadata: { to: input.to },
    })
    return getTenant(db, input.tenantId)!
  })
}

export function suspendTenant(
  db: AdminDb,
  clock: Clock,
  tenantId: string,
  actorClerkUserId: string,
): TenantRow {
  return transitionTenantStatus(db, clock, {
    tenantId,
    actorClerkUserId,
    from: ['active'],
    to: 'suspended',
    action: 'tenant.suspend',
    extraSet: 'suspended_at = ?, pending_deletion_at = NULL',
    extraParams: [clock.nowMs()],
  })
}

export function reactivateTenant(
  db: AdminDb,
  clock: Clock,
  tenantId: string,
  actorClerkUserId: string,
): TenantRow {
  return transitionTenantStatus(db, clock, {
    tenantId,
    actorClerkUserId,
    from: ['suspended'],
    to: 'active',
    action: 'tenant.reactivate',
    extraSet: 'suspended_at = NULL, pending_deletion_at = NULL',
    extraParams: [],
  })
}

export function markTenantPendingDeletion(
  db: AdminDb,
  clock: Clock,
  tenantId: string,
  actorClerkUserId: string,
): TenantRow {
  return transitionTenantStatus(db, clock, {
    tenantId,
    actorClerkUserId,
    from: ['active', 'suspended'],
    to: 'pending_deletion',
    action: 'tenant.pending_deletion',
    extraSet: 'pending_deletion_at = ?, suspended_at = COALESCE(suspended_at, ?)',
    extraParams: [clock.nowMs(), clock.nowMs()],
  })
}
