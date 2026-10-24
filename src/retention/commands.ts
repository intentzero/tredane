/**
 * Avanço de `tenant_deletion_commands` (#43) — checkpoints / retries.
 */
import type { Clock } from '../db/clock'
import { writeAudit } from '../db/admin/audit'
import { ConflictError, NotFoundError } from '../db/admin/errors'
import { assertAdminSchemaReady } from '../db/admin/gate'
import type { AdminDb } from '../db/admin/store'
import { getTenant } from '../db/admin/tenants'
import type { DeletionCommandStatus } from '../db/schema'
import { purgeAlertAt, purgeDeadlineAt } from './policy'
import { isTerminalPurgeStep, nextPurgeStep, type TenantPurgeStep } from './steps'

export type PurgeCommandRow = {
  id: string
  tenantId: string
  status: DeletionCommandStatus
  requestedByClerkUserId: string
  requestedAt: number
  updatedAt: number
  payloadJson: string | null
  deadlineAt: number | null
  startedAt: number | null
  completedAt: number | null
  lastStep: string | null
  lastError: string | null
  alertSentAt: number | null
}

function mapCommand(row: {
  id: string
  tenant_id: string
  status: string
  requested_by_clerk_user_id: string
  requested_at: number
  updated_at: number
  payload_json: string | null
  deadline_at: number | null
  started_at: number | null
  completed_at: number | null
  last_step: string | null
  last_error: string | null
  alert_sent_at: number | null
}): PurgeCommandRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: row.status as DeletionCommandStatus,
    requestedByClerkUserId: row.requested_by_clerk_user_id,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
    payloadJson: row.payload_json,
    deadlineAt: row.deadline_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastStep: row.last_step,
    lastError: row.last_error,
    alertSentAt: row.alert_sent_at,
  }
}

const SELECT_COLS = `id, tenant_id, status, requested_by_clerk_user_id, requested_at, updated_at,
  payload_json, deadline_at, started_at, completed_at, last_step, last_error, alert_sent_at`

export function getPurgeCommand(
  db: AdminDb,
  commandId: string,
): PurgeCommandRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<Parameters<typeof mapCommand>[0]>(
    `SELECT ${SELECT_COLS} FROM tenant_deletion_commands WHERE id = ?`,
    commandId,
  )
  return row ? mapCommand(row) : undefined
}

export function getOpenPurgeCommand(
  db: AdminDb,
  tenantId: string,
): PurgeCommandRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<Parameters<typeof mapCommand>[0]>(
    `SELECT ${SELECT_COLS}
     FROM tenant_deletion_commands
     WHERE tenant_id = ? AND status IN ('queued', 'in_progress')
     ORDER BY requested_at DESC
     LIMIT 1`,
    tenantId,
  )
  return row ? mapCommand(row) : undefined
}

export function listPurgeCommandsForTenant(
  db: AdminDb,
  tenantId: string,
): PurgeCommandRow[] {
  assertAdminSchemaReady(db)
  return db
    .all<Parameters<typeof mapCommand>[0]>(
      `SELECT ${SELECT_COLS}
       FROM tenant_deletion_commands
       WHERE tenant_id = ?
       ORDER BY requested_at DESC`,
      tenantId,
    )
    .map(mapCommand)
}

/** Garante deadline_at a partir de pending_deletion_at (idempotente). */
export function ensurePurgeDeadline(
  db: AdminDb,
  clock: Clock,
  command: PurgeCommandRow,
): PurgeCommandRow {
  if (command.deadlineAt != null) return command
  const tenant = getTenant(db, command.tenantId)
  const base = tenant?.pendingDeletionAt ?? command.requestedAt
  const deadline = purgeDeadlineAt(base)
  const now = clock.nowMs()
  db.run(
    `UPDATE tenant_deletion_commands
     SET deadline_at = ?, updated_at = ?
     WHERE id = ? AND deadline_at IS NULL`,
    deadline,
    now,
    command.id,
  )
  return getPurgeCommand(db, command.id)!
}

export function markPurgeStep(
  db: AdminDb,
  clock: Clock,
  input: {
    commandId: string
    step: TenantPurgeStep
    actorClerkUserId: string
    error?: string | null
    status?: DeletionCommandStatus
    extraPayload?: Record<string, unknown>
  },
): PurgeCommandRow {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const current = getPurgeCommand(db, input.commandId)
  if (!current) throw new NotFoundError('deletion_command_not_found', 'Comando inexistente')

  let payload = current.payloadJson ? JSON.parse(current.payloadJson) as Record<string, unknown> : {}
  if (input.extraPayload) payload = { ...payload, ...input.extraPayload }

  const status =
    input.status ??
    (input.step === 'completed'
      ? 'completed'
      : current.status === 'queued'
        ? 'in_progress'
        : current.status)

  const startedAt = current.startedAt ?? (status === 'in_progress' || status === 'completed' ? now : null)
  const completedAt = input.step === 'completed' ? now : current.completedAt

  db.run(
    `UPDATE tenant_deletion_commands
     SET status = ?, last_step = ?, last_error = ?, updated_at = ?,
         started_at = COALESCE(started_at, ?), completed_at = ?,
         payload_json = ?
     WHERE id = ?`,
    status,
    input.step,
    input.error ?? null,
    now,
    startedAt,
    completedAt,
    JSON.stringify(payload),
    input.commandId,
  )

  writeAudit(db, clock, {
    actorClerkUserId: input.actorClerkUserId,
    tenantId: current.tenantId,
    action: 'tenant.purge.step',
    objectType: 'tenant_deletion_command',
    objectId: input.commandId,
    outcome: input.error ? 'error' : 'success',
    metadata: {
      step: input.step,
      status,
      // Sem PHI
    },
  })

  return getPurgeCommand(db, input.commandId)!
}

export function maybeSendPurgeDeadlineAlert(
  db: AdminDb,
  clock: Clock,
  command: PurgeCommandRow,
  actorClerkUserId: string,
): { alerted: boolean; overdue: boolean } {
  const withDeadline = ensurePurgeDeadline(db, clock, command)
  if (!withDeadline.deadlineAt || isTerminalPurgeStep(withDeadline.lastStep)) {
    return { alerted: false, overdue: false }
  }
  const now = clock.nowMs()
  const overdue = now > withDeadline.deadlineAt
  const shouldAlert =
    overdue || now >= purgeAlertAt(withDeadline.deadlineAt)
  if (!shouldAlert || withDeadline.alertSentAt != null) {
    return { alerted: false, overdue }
  }
  db.run(
    `UPDATE tenant_deletion_commands SET alert_sent_at = ?, updated_at = ? WHERE id = ?`,
    now,
    now,
    withDeadline.id,
  )
  writeAudit(db, clock, {
    actorClerkUserId,
    tenantId: withDeadline.tenantId,
    action: 'tenant.purge.deadline_alert',
    objectType: 'tenant_deletion_command',
    objectId: withDeadline.id,
    outcome: 'success',
    metadata: {
      deadlineAt: withDeadline.deadlineAt,
      overdue,
      lastStep: withDeadline.lastStep,
    },
  })
  return { alerted: true, overdue }
}

export function assertTenantPendingDeletion(db: AdminDb, tenantId: string): void {
  const tenant = getTenant(db, tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
  if (tenant.status !== 'pending_deletion' && tenant.status !== 'purged') {
    throw new ConflictError(
      'tenant_not_pending_deletion',
      'Expurgo só para pending_deletion',
    )
  }
}

export function resolveNextStep(command: PurgeCommandRow): TenantPurgeStep | null {
  if (command.status === 'completed') return null
  if (command.status === 'cancelled') return null
  return nextPurgeStep(command.lastStep ?? (command.status === 'queued' ? 'queued' : null))
}
