/**
 * Ciclo de vida do tenant na Platform Admin (#24 / REQ-006).
 * Suspensão/exclusão lógica cortam operação; reativação NÃO restaura
 * memberships nem sessões de suporte já revogados.
 */
import type { Clock } from '../clock'
import { writeAudit } from './audit'
import { enqueueDeletionCommandInTx, type DeletionCommandRow } from './deletion-commands'
import { ConflictError, NotFoundError } from './errors'
import { assertAdminSchemaReady } from './gate'
import type { AdminDb } from './store'
import {
  getTenant,
  markTenantPendingDeletion,
  reactivateTenant,
  suspendTenant,
  type TenantRow,
} from './tenants'

export type LifecycleSideEffects = {
  /** Sessões de suporte ativas revogadas nesta transição. */
  revokedSupportSessionIds: string[]
  /** Pedidos de suporte pending cancelados. */
  cancelledSupportRequestIds: string[]
  deletionCommand?: DeletionCommandRow
}

function revokeActiveSupportForTenantInTx(
  db: AdminDb,
  clock: Clock,
  tenantId: string,
  actorClerkUserId: string,
  reason: 'tenant_suspend' | 'tenant_pending_deletion',
): { revokedSupportSessionIds: string[]; cancelledSupportRequestIds: string[] } {
  const now = clock.nowMs()
  const activeSessions = db.all<{ id: string; subject_clerk_user_id: string }>(
    `SELECT id, subject_clerk_user_id FROM support_sessions
     WHERE tenant_id = ? AND status = 'active'`,
    tenantId,
  )
  const revokedSupportSessionIds: string[] = []
  for (const session of activeSessions) {
    const result = db.run(
      `UPDATE support_sessions
       SET status = 'revoked', revoked_at = ?, revoked_by_clerk_user_id = ?, ended_at = ?,
           handoff_hash = NULL
       WHERE id = ? AND status = 'active'`,
      now,
      actorClerkUserId,
      now,
      session.id,
    )
    if (result.changes === 1) {
      revokedSupportSessionIds.push(session.id)
      writeAudit(db, clock, {
        actorClerkUserId,
        subjectClerkUserId: session.subject_clerk_user_id,
        tenantId,
        action: 'support.session.revoke',
        objectType: 'support_session',
        objectId: session.id,
        outcome: 'success',
        supportSessionId: session.id,
        metadata: { reason },
      })
    }
  }

  const pending = db.all<{ id: string }>(
    `SELECT id FROM support_access_requests
     WHERE tenant_id = ? AND status = 'pending'`,
    tenantId,
  )
  const cancelledSupportRequestIds: string[] = []
  for (const req of pending) {
    const result = db.run(
      `UPDATE support_access_requests
       SET status = 'cancelled', cancelled_at = ?
       WHERE id = ? AND status = 'pending'`,
      now,
      req.id,
    )
    if (result.changes === 1) {
      cancelledSupportRequestIds.push(req.id)
      writeAudit(db, clock, {
        actorClerkUserId,
        tenantId,
        action: 'support.request.cancel',
        objectType: 'support_access_request',
        objectId: req.id,
        outcome: 'success',
        metadata: { reason },
      })
    }
  }

  return { revokedSupportSessionIds, cancelledSupportRequestIds }
}

export function suspendTenantLifecycle(
  db: AdminDb,
  clock: Clock,
  tenantId: string,
  actorClerkUserId: string,
): { tenant: TenantRow } & LifecycleSideEffects {
  assertAdminSchemaReady(db)
  return db.immediate(() => {
    // suspendTenant aninha immediate — aplicar transição inline.
    const now = clock.nowMs()
    const result = db.run(
      `UPDATE tenants
       SET status = 'suspended', updated_at = ?, suspended_at = ?, pending_deletion_at = NULL
       WHERE id = ? AND status = 'active'`,
      now,
      now,
      tenantId,
    )
    if (result.changes !== 1) {
      const current = getTenant(db, tenantId)
      if (!current) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
      throw new ConflictError(
        'tenant_status_conflict',
        `Transição ${current.status} → suspended inválida`,
      )
    }
    writeAudit(db, clock, {
      actorClerkUserId,
      tenantId,
      action: 'tenant.suspend',
      objectType: 'tenant',
      objectId: tenantId,
      outcome: 'success',
      metadata: { to: 'suspended' },
    })
    const side = revokeActiveSupportForTenantInTx(
      db,
      clock,
      tenantId,
      actorClerkUserId,
      'tenant_suspend',
    )
    return { tenant: getTenant(db, tenantId)!, ...side }
  })
}

/**
 * Reativa tenant suspenso. Memberships revogados e suporte revogado
 * permanecem revogados (aceitação #24).
 */
export function reactivateTenantLifecycle(
  db: AdminDb,
  clock: Clock,
  tenantId: string,
  actorClerkUserId: string,
): { tenant: TenantRow; preservedRevokedMemberships: number; preservedRevokedSupport: number } {
  assertAdminSchemaReady(db)
  const beforeRevokedMembers = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tenant_memberships
     WHERE tenant_id = ? AND status = 'revoked'`,
    tenantId,
  )
  const beforeRevokedSupport = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM support_sessions
     WHERE tenant_id = ? AND status = 'revoked'`,
    tenantId,
  )
  const tenant = reactivateTenant(db, clock, tenantId, actorClerkUserId)
  const afterRevokedMembers = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tenant_memberships
     WHERE tenant_id = ? AND status = 'revoked'`,
    tenantId,
  )
  const afterRevokedSupport = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM support_sessions
     WHERE tenant_id = ? AND status = 'revoked'`,
    tenantId,
  )
  if (Number(afterRevokedMembers?.n) !== Number(beforeRevokedMembers?.n)) {
    throw new ConflictError(
      'reactivate_restored_memberships',
      'Reativação não deve restaurar memberships',
    )
  }
  if (Number(afterRevokedSupport?.n) !== Number(beforeRevokedSupport?.n)) {
    throw new ConflictError(
      'reactivate_restored_support',
      'Reativação não deve restaurar suporte',
    )
  }
  return {
    tenant,
    preservedRevokedMemberships: Number(beforeRevokedMembers?.n ?? 0),
    preservedRevokedSupport: Number(beforeRevokedSupport?.n ?? 0),
  }
}

export function markTenantPendingDeletionLifecycle(
  db: AdminDb,
  clock: Clock,
  tenantId: string,
  actorClerkUserId: string,
): { tenant: TenantRow } & LifecycleSideEffects {
  assertAdminSchemaReady(db)
  return db.immediate(() => {
    const now = clock.nowMs()
    const result = db.run(
      `UPDATE tenants
       SET status = 'pending_deletion', updated_at = ?,
           pending_deletion_at = ?, suspended_at = COALESCE(suspended_at, ?)
       WHERE id = ? AND status IN ('active', 'suspended')`,
      now,
      now,
      now,
      tenantId,
    )
    if (result.changes !== 1) {
      const current = getTenant(db, tenantId)
      if (!current) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
      throw new ConflictError(
        'tenant_status_conflict',
        `Transição ${current.status} → pending_deletion inválida`,
      )
    }
    writeAudit(db, clock, {
      actorClerkUserId,
      tenantId,
      action: 'tenant.pending_deletion',
      objectType: 'tenant',
      objectId: tenantId,
      outcome: 'success',
      metadata: { to: 'pending_deletion' },
    })
    const side = revokeActiveSupportForTenantInTx(
      db,
      clock,
      tenantId,
      actorClerkUserId,
      'tenant_pending_deletion',
    )
    const deletionCommand = enqueueDeletionCommandInTx(db, clock, {
      tenantId,
      actorClerkUserId,
    })
    return { tenant: getTenant(db, tenantId)!, ...side, deletionCommand }
  })
}

// Re-export para callers que precisam das primitivas simples.
export { markTenantPendingDeletion, reactivateTenant, suspendTenant }
