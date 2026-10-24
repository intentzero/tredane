import type { Clock } from '../clock'
import type { DeletionCommandStatus } from '../schema'
import { purgeDeadlineAt } from '../../retention/policy'
import { writeAudit } from './audit'
import { ConflictError, NotFoundError } from './errors'
import { assertAdminSchemaReady } from './gate'
import { newId } from './ids'
import type { AdminDb } from './store'
import { getTenant } from './tenants'

export type DeletionCommandRow = {
  id: string
  tenantId: string
  status: DeletionCommandStatus
  requestedByClerkUserId: string
  requestedAt: number
  updatedAt: number
  payloadJson: string | null
}

function mapCommand(row: {
  id: string
  tenant_id: string
  status: string
  requested_by_clerk_user_id: string
  requested_at: number
  updated_at: number
  payload_json: string | null
}): DeletionCommandRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: row.status as DeletionCommandStatus,
    requestedByClerkUserId: row.requested_by_clerk_user_id,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
    payloadJson: row.payload_json,
  }
}

export function getOpenDeletionCommand(
  db: AdminDb,
  tenantId: string,
): DeletionCommandRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<{
    id: string
    tenant_id: string
    status: string
    requested_by_clerk_user_id: string
    requested_at: number
    updated_at: number
    payload_json: string | null
  }>(
    `SELECT id, tenant_id, status, requested_by_clerk_user_id, requested_at, updated_at, payload_json
     FROM tenant_deletion_commands
     WHERE tenant_id = ? AND status IN ('queued', 'in_progress')
     ORDER BY requested_at DESC
     LIMIT 1`,
    tenantId,
  )
  return row ? mapCommand(row) : undefined
}

export function listDeletionCommandsForTenant(
  db: AdminDb,
  tenantId: string,
): DeletionCommandRow[] {
  assertAdminSchemaReady(db)
  const rows = db.all<{
    id: string
    tenant_id: string
    status: string
    requested_by_clerk_user_id: string
    requested_at: number
    updated_at: number
    payload_json: string | null
  }>(
    `SELECT id, tenant_id, status, requested_by_clerk_user_id, requested_at, updated_at, payload_json
     FROM tenant_deletion_commands
     WHERE tenant_id = ?
     ORDER BY requested_at DESC`,
    tenantId,
  )
  return rows.map(mapCommand)
}

/**
 * Enfileira comando durável para a tarefa de retenção/expurgo (#24).
 * Idempotente se já existir comando aberto para o tenant.
 */
export function enqueueDeletionCommandInTx(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    actorClerkUserId: string
    payload?: Record<string, unknown>
  },
): DeletionCommandRow {
  assertAdminSchemaReady(db)
  const existing = getOpenDeletionCommand(db, input.tenantId)
  if (existing) return existing

  const now = clock.nowMs()
  const id = newId('tdel')
  const tenant = getTenant(db, input.tenantId)
  const pendingAt = tenant?.pendingDeletionAt ?? now
  const deadlineAt = purgeDeadlineAt(pendingAt)
  const payloadJson = JSON.stringify({
    reason: 'logical_deletion',
    deadlineAt,
    ...input.payload,
  })
  db.run(
    `INSERT INTO tenant_deletion_commands (
      id, tenant_id, status, requested_by_clerk_user_id, requested_at, updated_at, payload_json,
      deadline_at, started_at, completed_at, last_step, last_error, alert_sent_at
    ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)`,
    id,
    input.tenantId,
    input.actorClerkUserId,
    now,
    now,
    payloadJson,
    deadlineAt,
  )
  writeAudit(db, clock, {
    actorClerkUserId: input.actorClerkUserId,
    tenantId: input.tenantId,
    action: 'tenant.deletion_command.enqueue',
    objectType: 'tenant_deletion_command',
    objectId: id,
    outcome: 'success',
    metadata: { status: 'queued' },
  })
  return getOpenDeletionCommand(db, input.tenantId)!
}

export function enqueueDeletionCommand(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    actorClerkUserId: string
    payload?: Record<string, unknown>
  },
): DeletionCommandRow {
  const tenant = getTenant(db, input.tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
  if (tenant.status !== 'pending_deletion') {
    throw new ConflictError(
      'tenant_not_pending_deletion',
      'Comando de exclusão só para pending_deletion',
    )
  }
  return db.immediate(() => enqueueDeletionCommandInTx(db, clock, input))
}
