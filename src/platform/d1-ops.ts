/**
 * Mutações Platform Admin no D1 assíncrono (Worker / harness).
 * Espelha as regras dos repositórios sync; concorrência via UPDATE … WHERE + changes.
 */
import { newId } from '../db/admin/ids'
import type { DeletionCommandRow } from '../db/admin/deletion-commands'
import type { MembershipRow } from '../db/admin/memberships'
import type { TenantRow } from '../db/admin/tenants'
import { ConflictError, ForbiddenError, NotFoundError } from '../db/admin/errors'

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
    status: row.status as TenantRow['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    suspendedAt: row.suspended_at,
    pendingDeletionAt: row.pending_deletion_at,
  }
}

function mapMembership(row: {
  tenant_id: string
  clerk_user_id: string
  role: string
  status: string
  created_at: number
  revoked_at: number | null
}): MembershipRow {
  return {
    tenantId: row.tenant_id,
    clerkUserId: row.clerk_user_id,
    role: row.role as MembershipRow['role'],
    status: row.status as MembershipRow['status'],
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }
}

async function audit(
  db: D1Database,
  input: {
    actorClerkUserId: string
    subjectClerkUserId?: string | null
    tenantId: string
    action: string
    objectType: string
    objectId: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO central_audit_events (
        id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
        action, object_type, object_id, outcome, support_session_id, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', NULL, ?)`,
    )
    .bind(
      newId('aud'),
      now,
      input.actorClerkUserId,
      input.subjectClerkUserId ?? null,
      input.tenantId,
      input.action,
      input.objectType,
      input.objectId,
      input.metadata ? JSON.stringify(input.metadata) : null,
    )
    .run()
}

export async function d1GetTenant(
  db: D1Database,
  tenantId: string,
): Promise<TenantRow | null> {
  const row = await db
    .prepare(
      `SELECT id, name, timezone, status, created_at, updated_at, suspended_at, pending_deletion_at
       FROM tenants WHERE id = ?`,
    )
    .bind(tenantId)
    .first<{
      id: string
      name: string
      timezone: string
      status: string
      created_at: number
      updated_at: number
      suspended_at: number | null
      pending_deletion_at: number | null
    }>()
  return row ? mapTenant(row) : null
}

export async function d1ListTenants(db: D1Database): Promise<TenantRow[]> {
  const result = await db
    .prepare(
      `SELECT id, name, timezone, status, created_at, updated_at, suspended_at, pending_deletion_at
       FROM tenants ORDER BY id`,
    )
    .all<{
      id: string
      name: string
      timezone: string
      status: string
      created_at: number
      updated_at: number
      suspended_at: number | null
      pending_deletion_at: number | null
    }>()
  return (result.results ?? []).map(mapTenant)
}

export async function d1ListMembers(
  db: D1Database,
  tenantId: string,
): Promise<MembershipRow[]> {
  const result = await db
    .prepare(
      `SELECT tenant_id, clerk_user_id, role, status, created_at, revoked_at
       FROM tenant_memberships WHERE tenant_id = ? ORDER BY clerk_user_id`,
    )
    .bind(tenantId)
    .all<{
      tenant_id: string
      clerk_user_id: string
      role: string
      status: string
      created_at: number
      revoked_at: number | null
    }>()
  return (result.results ?? []).map(mapMembership)
}

export async function d1CreateTenantWithOwner(
  db: D1Database,
  input: {
    id?: string
    name: string
    timezone?: string
    ownerClerkUserId: string
    actorClerkUserId: string
  },
): Promise<{ tenant: TenantRow; owner: MembershipRow }> {
  const now = Date.now()
  const id = input.id ?? newId('tenant')
  const name = input.name.trim()
  const ownerId = input.ownerClerkUserId.trim()
  const timezone = input.timezone?.trim() || 'America/Sao_Paulo'
  if (!name || !ownerId) throw new ConflictError('name_and_owner_required', 'Nome e owner obrigatórios')

  const existing = await d1GetTenant(db, id)
  if (existing) throw new ConflictError('tenant_id_conflict', 'Tenant id já existe')

  await db.batch([
    db
      .prepare(
        `INSERT INTO tenants (id, name, timezone, status, created_at, updated_at, suspended_at, pending_deletion_at)
         VALUES (?, ?, ?, 'active', ?, ?, NULL, NULL)`,
      )
      .bind(id, name, timezone, now, now),
    db
      .prepare(
        `INSERT INTO tenant_memberships (tenant_id, clerk_user_id, role, status, created_at, revoked_at)
         VALUES (?, ?, 'owner', 'active', ?, NULL)`,
      )
      .bind(id, ownerId, now),
    db
      .prepare(
        `INSERT INTO central_audit_events (
          id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
          action, object_type, object_id, outcome, support_session_id, metadata_json
        ) VALUES (?, ?, ?, ?, ?, 'tenant.create', 'tenant', ?, 'success', NULL, ?)`,
      )
      .bind(
        newId('aud'),
        now,
        input.actorClerkUserId,
        ownerId,
        id,
        id,
        JSON.stringify({ name, firstOwner: ownerId }),
      ),
  ])

  const tenant = (await d1GetTenant(db, id))!
  const ownerRow = await db
    .prepare(
      `SELECT tenant_id, clerk_user_id, role, status, created_at, revoked_at
       FROM tenant_memberships WHERE tenant_id = ? AND clerk_user_id = ?`,
    )
    .bind(id, ownerId)
    .first<{
      tenant_id: string
      clerk_user_id: string
      role: string
      status: string
      created_at: number
      revoked_at: number | null
    }>()
  return { tenant, owner: mapMembership(ownerRow!) }
}

async function revokeSupportForTenant(
  db: D1Database,
  tenantId: string,
  actorClerkUserId: string,
  reason: string,
): Promise<{ revokedSupportSessionIds: string[]; cancelledSupportRequestIds: string[] }> {
  const now = Date.now()
  const sessions = await db
    .prepare(
      `SELECT id, subject_clerk_user_id FROM support_sessions
       WHERE tenant_id = ? AND status = 'active'`,
    )
    .bind(tenantId)
    .all<{ id: string; subject_clerk_user_id: string }>()
  const revokedSupportSessionIds: string[] = []
  for (const s of sessions.results ?? []) {
    const updated = await db
      .prepare(
        `UPDATE support_sessions
         SET status = 'revoked', revoked_at = ?, revoked_by_clerk_user_id = ?, ended_at = ?,
             handoff_hash = NULL
         WHERE id = ? AND status = 'active'`,
      )
      .bind(now, actorClerkUserId, now, s.id)
      .run()
    if (updated.meta.changes && updated.meta.changes > 0) {
      revokedSupportSessionIds.push(s.id)
      await audit(db, {
        actorClerkUserId,
        subjectClerkUserId: s.subject_clerk_user_id,
        tenantId,
        action: 'support.session.revoke',
        objectType: 'support_session',
        objectId: s.id,
        metadata: { reason },
      })
    }
  }

  const pending = await db
    .prepare(
      `SELECT id FROM support_access_requests WHERE tenant_id = ? AND status = 'pending'`,
    )
    .bind(tenantId)
    .all<{ id: string }>()
  const cancelledSupportRequestIds: string[] = []
  for (const r of pending.results ?? []) {
    const updated = await db
      .prepare(
        `UPDATE support_access_requests
         SET status = 'cancelled', cancelled_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(now, r.id)
      .run()
    if (updated.meta.changes && updated.meta.changes > 0) {
      cancelledSupportRequestIds.push(r.id)
    }
  }
  return { revokedSupportSessionIds, cancelledSupportRequestIds }
}

export async function d1SuspendTenant(
  db: D1Database,
  tenantId: string,
  actorClerkUserId: string,
): Promise<{
  tenant: TenantRow
  revokedSupportSessionIds: string[]
  cancelledSupportRequestIds: string[]
}> {
  const now = Date.now()
  const updated = await db
    .prepare(
      `UPDATE tenants
       SET status = 'suspended', updated_at = ?, suspended_at = ?, pending_deletion_at = NULL
       WHERE id = ? AND status = 'active'`,
    )
    .bind(now, now, tenantId)
    .run()
  if (!updated.meta.changes || updated.meta.changes < 1) {
    const current = await d1GetTenant(db, tenantId)
    if (!current) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
    throw new ConflictError('tenant_status_conflict', `Transição ${current.status} → suspended inválida`)
  }
  await audit(db, {
    actorClerkUserId,
    tenantId,
    action: 'tenant.suspend',
    objectType: 'tenant',
    objectId: tenantId,
    metadata: { to: 'suspended' },
  })
  const side = await revokeSupportForTenant(db, tenantId, actorClerkUserId, 'tenant_suspend')
  return { tenant: (await d1GetTenant(db, tenantId))!, ...side }
}

export async function d1ReactivateTenant(
  db: D1Database,
  tenantId: string,
  actorClerkUserId: string,
): Promise<{
  tenant: TenantRow
  preservedRevokedMemberships: number
  preservedRevokedSupport: number
}> {
  const beforeM = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM tenant_memberships WHERE tenant_id = ? AND status = 'revoked'`,
    )
    .bind(tenantId)
    .first<{ n: number }>()
  const beforeS = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM support_sessions WHERE tenant_id = ? AND status = 'revoked'`,
    )
    .bind(tenantId)
    .first<{ n: number }>()

  const now = Date.now()
  const updated = await db
    .prepare(
      `UPDATE tenants
       SET status = 'active', updated_at = ?, suspended_at = NULL, pending_deletion_at = NULL
       WHERE id = ? AND status = 'suspended'`,
    )
    .bind(now, tenantId)
    .run()
  if (!updated.meta.changes || updated.meta.changes < 1) {
    const current = await d1GetTenant(db, tenantId)
    if (!current) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
    throw new ConflictError('tenant_status_conflict', `Transição ${current.status} → active inválida`)
  }
  await audit(db, {
    actorClerkUserId,
    tenantId,
    action: 'tenant.reactivate',
    objectType: 'tenant',
    objectId: tenantId,
    metadata: { to: 'active' },
  })

  const afterM = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM tenant_memberships WHERE tenant_id = ? AND status = 'revoked'`,
    )
    .bind(tenantId)
    .first<{ n: number }>()
  const afterS = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM support_sessions WHERE tenant_id = ? AND status = 'revoked'`,
    )
    .bind(tenantId)
    .first<{ n: number }>()

  if (Number(afterM?.n) !== Number(beforeM?.n) || Number(afterS?.n) !== Number(beforeS?.n)) {
    throw new ConflictError('reactivate_restored', 'Reativação restaurou estado indevido')
  }

  return {
    tenant: (await d1GetTenant(db, tenantId))!,
    preservedRevokedMemberships: Number(beforeM?.n ?? 0),
    preservedRevokedSupport: Number(beforeS?.n ?? 0),
  }
}

export async function d1PendingDeletion(
  db: D1Database,
  tenantId: string,
  actorClerkUserId: string,
): Promise<{
  tenant: TenantRow
  deletionCommand: DeletionCommandRow
  revokedSupportSessionIds: string[]
  cancelledSupportRequestIds: string[]
}> {
  const now = Date.now()
  const updated = await db
    .prepare(
      `UPDATE tenants
       SET status = 'pending_deletion', updated_at = ?,
           pending_deletion_at = ?, suspended_at = COALESCE(suspended_at, ?)
       WHERE id = ? AND status IN ('active', 'suspended')`,
    )
    .bind(now, now, now, tenantId)
    .run()
  if (!updated.meta.changes || updated.meta.changes < 1) {
    const current = await d1GetTenant(db, tenantId)
    if (!current) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
    throw new ConflictError(
      'tenant_status_conflict',
      `Transição ${current.status} → pending_deletion inválida`,
    )
  }
  await audit(db, {
    actorClerkUserId,
    tenantId,
    action: 'tenant.pending_deletion',
    objectType: 'tenant',
    objectId: tenantId,
    metadata: { to: 'pending_deletion' },
  })
  const side = await revokeSupportForTenant(
    db,
    tenantId,
    actorClerkUserId,
    'tenant_pending_deletion',
  )

  const open = await db
    .prepare(
      `SELECT id, tenant_id, status, requested_by_clerk_user_id, requested_at, updated_at, payload_json
       FROM tenant_deletion_commands
       WHERE tenant_id = ? AND status IN ('queued', 'in_progress') LIMIT 1`,
    )
    .bind(tenantId)
    .first<{
      id: string
      tenant_id: string
      status: string
      requested_by_clerk_user_id: string
      requested_at: number
      updated_at: number
      payload_json: string | null
    }>()

  let deletionCommand: DeletionCommandRow
  if (open) {
    deletionCommand = {
      id: open.id,
      tenantId: open.tenant_id,
      status: open.status as DeletionCommandRow['status'],
      requestedByClerkUserId: open.requested_by_clerk_user_id,
      requestedAt: open.requested_at,
      updatedAt: open.updated_at,
      payloadJson: open.payload_json,
    }
  } else {
    const id = newId('tdel')
    const tenantRow = await d1GetTenant(db, tenantId)
    const pendingAt = tenantRow?.pendingDeletionAt ?? now
    const deadlineAt = pendingAt + 30 * 24 * 60 * 60 * 1000
    await db
      .prepare(
        `INSERT INTO tenant_deletion_commands (
          id, tenant_id, status, requested_by_clerk_user_id, requested_at, updated_at, payload_json,
          deadline_at, started_at, completed_at, last_step, last_error, alert_sent_at
        ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)`,
      )
      .bind(
        id,
        tenantId,
        actorClerkUserId,
        now,
        now,
        JSON.stringify({ reason: 'logical_deletion', deadlineAt }),
        deadlineAt,
      )
      .run()
    await audit(db, {
      actorClerkUserId,
      tenantId,
      action: 'tenant.deletion_command.enqueue',
      objectType: 'tenant_deletion_command',
      objectId: id,
      metadata: { status: 'queued', deadlineAt },
    })
    deletionCommand = {
      id,
      tenantId,
      status: 'queued',
      requestedByClerkUserId: actorClerkUserId,
      requestedAt: now,
      updatedAt: now,
      payloadJson: JSON.stringify({ reason: 'logical_deletion', deadlineAt }),
    }
  }

  return {
    tenant: (await d1GetTenant(db, tenantId))!,
    deletionCommand,
    ...side,
  }
}

export async function d1UpdateTenant(
  db: D1Database,
  input: {
    tenantId: string
    actorClerkUserId: string
    name?: string
    timezone?: string
  },
): Promise<TenantRow> {
  const current = await d1GetTenant(db, input.tenantId)
  if (!current) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
  if (current.status === 'pending_deletion') {
    throw new ConflictError('tenant_pending_deletion', 'Tenant em exclusão lógica')
  }
  const name = input.name?.trim() || current.name
  const timezone = input.timezone?.trim() || current.timezone
  const now = Date.now()
  const updated = await db
    .prepare(
      `UPDATE tenants SET name = ?, timezone = ?, updated_at = ?
       WHERE id = ? AND status IN ('active', 'suspended')`,
    )
    .bind(name, timezone, now, input.tenantId)
    .run()
  if (!updated.meta.changes || updated.meta.changes < 1) {
    throw new ConflictError('tenant_update_conflict', 'Edição não aplicada')
  }
  await audit(db, {
    actorClerkUserId: input.actorClerkUserId,
    tenantId: input.tenantId,
    action: 'tenant.update',
    objectType: 'tenant',
    objectId: input.tenantId,
    metadata: {
      before: { name: current.name, timezone: current.timezone },
      after: { name, timezone },
    },
  })
  return (await d1GetTenant(db, input.tenantId))!
}

export async function d1AssignOwner(
  db: D1Database,
  input: { tenantId: string; clerkUserId: string; actorClerkUserId: string },
): Promise<MembershipRow> {
  const tenant = await d1GetTenant(db, input.tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
  if (tenant.status === 'pending_deletion') {
    throw new ConflictError('tenant_pending_deletion', 'Tenant em exclusão lógica')
  }
  const now = Date.now()
  const existing = await db
    .prepare(
      `SELECT tenant_id, clerk_user_id, role, status, created_at, revoked_at
       FROM tenant_memberships WHERE tenant_id = ? AND clerk_user_id = ?`,
    )
    .bind(input.tenantId, input.clerkUserId)
    .first<{
      tenant_id: string
      clerk_user_id: string
      role: string
      status: string
      created_at: number
      revoked_at: number | null
    }>()

  if (existing?.status === 'active' && existing.role === 'owner') {
    return mapMembership(existing)
  }
  if (existing?.status === 'active' && existing.role === 'attendant') {
    const updated = await db
      .prepare(
        `UPDATE tenant_memberships SET role = 'owner'
         WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active' AND role = 'attendant'`,
      )
      .bind(input.tenantId, input.clerkUserId)
      .run()
    if (!updated.meta.changes || updated.meta.changes < 1) {
      throw new ConflictError('owner_promote_conflict', 'Promoção não aplicada')
    }
    await audit(db, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.clerkUserId,
      tenantId: input.tenantId,
      action: 'owner.promote',
      objectType: 'tenant_membership',
      objectId: `${input.tenantId}:${input.clerkUserId}`,
      metadata: { from: 'attendant', to: 'owner' },
    })
  } else if (existing?.status === 'revoked') {
    await db
      .prepare(
        `UPDATE tenant_memberships
         SET role = 'owner', status = 'active', created_at = ?, revoked_at = NULL
         WHERE tenant_id = ? AND clerk_user_id = ?`,
      )
      .bind(now, input.tenantId, input.clerkUserId)
      .run()
    await audit(db, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.clerkUserId,
      tenantId: input.tenantId,
      action: 'owner.assign',
      objectType: 'tenant_membership',
      objectId: `${input.tenantId}:${input.clerkUserId}`,
      metadata: { as: 'reactivate_as_owner' },
    })
  } else {
    await db
      .prepare(
        `INSERT INTO tenant_memberships (tenant_id, clerk_user_id, role, status, created_at, revoked_at)
         VALUES (?, ?, 'owner', 'active', ?, NULL)`,
      )
      .bind(input.tenantId, input.clerkUserId, now)
      .run()
    await audit(db, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.clerkUserId,
      tenantId: input.tenantId,
      action: 'owner.assign',
      objectType: 'tenant_membership',
      objectId: `${input.tenantId}:${input.clerkUserId}`,
      metadata: { as: 'new_owner' },
    })
  }

  const row = await db
    .prepare(
      `SELECT tenant_id, clerk_user_id, role, status, created_at, revoked_at
       FROM tenant_memberships WHERE tenant_id = ? AND clerk_user_id = ?`,
    )
    .bind(input.tenantId, input.clerkUserId)
    .first<{
      tenant_id: string
      clerk_user_id: string
      role: string
      status: string
      created_at: number
      revoked_at: number | null
    }>()
  return mapMembership(row!)
}

export async function d1RemoveOwner(
  db: D1Database,
  input: { tenantId: string; clerkUserId: string; actorClerkUserId: string },
): Promise<MembershipRow> {
  const count = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM tenant_memberships
       WHERE tenant_id = ? AND role = 'owner' AND status = 'active'`,
    )
    .bind(input.tenantId)
    .first<{ n: number }>()
  if (Number(count?.n ?? 0) <= 1) {
    throw new ForbiddenError(
      'last_owner_protected',
      'Não é permitido remover o último owner ativo',
    )
  }
  const now = Date.now()
  const updated = await db
    .prepare(
      `UPDATE tenant_memberships
       SET status = 'revoked', revoked_at = ?
       WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active' AND role = 'owner'`,
    )
    .bind(now, input.tenantId, input.clerkUserId)
    .run()
  if (!updated.meta.changes || updated.meta.changes < 1) {
    throw new NotFoundError('owner_not_found', 'Owner ativo inexistente')
  }
  await audit(db, {
    actorClerkUserId: input.actorClerkUserId,
    subjectClerkUserId: input.clerkUserId,
    tenantId: input.tenantId,
    action: 'owner.remove',
    objectType: 'tenant_membership',
    objectId: `${input.tenantId}:${input.clerkUserId}`,
  })
  const row = await db
    .prepare(
      `SELECT tenant_id, clerk_user_id, role, status, created_at, revoked_at
       FROM tenant_memberships WHERE tenant_id = ? AND clerk_user_id = ?`,
    )
    .bind(input.tenantId, input.clerkUserId)
    .first<{
      tenant_id: string
      clerk_user_id: string
      role: string
      status: string
      created_at: number
      revoked_at: number | null
    }>()
  return mapMembership(row!)
}

export async function d1ListAudit(
  db: D1Database,
  tenantId: string,
  limit = 30,
): Promise<
  Array<{
    id: string
    action: string
    outcome: string
    occurredAt: number
    actorClerkUserId: string
    subjectClerkUserId: string | null
  }>
> {
  const result = await db
    .prepare(
      `SELECT id, action, outcome, occurred_at, actor_clerk_user_id, subject_clerk_user_id
       FROM central_audit_events
       WHERE tenant_id = ?
       ORDER BY occurred_at DESC
       LIMIT ?`,
    )
    .bind(tenantId, limit)
    .all<{
      id: string
      action: string
      outcome: string
      occurred_at: number
      actor_clerk_user_id: string
      subject_clerk_user_id: string | null
    }>()
  return (result.results ?? []).map((e) => ({
    id: e.id,
    action: e.action,
    outcome: e.outcome,
    occurredAt: e.occurred_at,
    actorClerkUserId: e.actor_clerk_user_id,
    subjectClerkUserId: e.subject_clerk_user_id,
  }))
}

export async function d1GetOpenDeletionCommand(
  db: D1Database,
  tenantId: string,
): Promise<DeletionCommandRow | null> {
  const open = await db
    .prepare(
      `SELECT id, tenant_id, status, requested_by_clerk_user_id, requested_at, updated_at, payload_json
       FROM tenant_deletion_commands
       WHERE tenant_id = ? AND status IN ('queued', 'in_progress') LIMIT 1`,
    )
    .bind(tenantId)
    .first<{
      id: string
      tenant_id: string
      status: string
      requested_by_clerk_user_id: string
      requested_at: number
      updated_at: number
      payload_json: string | null
    }>()
  if (!open) return null
  return {
    id: open.id,
    tenantId: open.tenant_id,
    status: open.status as DeletionCommandRow['status'],
    requestedByClerkUserId: open.requested_by_clerk_user_id,
    requestedAt: open.requested_at,
    updatedAt: open.updated_at,
    payloadJson: open.payload_json,
  }
}
