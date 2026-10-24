import { assertAdminSchemaReady } from './gate'
import { listMembersForTenant, listActiveMembershipsForUser } from './memberships'
import { listPendingInvitationsForTenant } from './invitations'
import { listAuditForTenant } from './audit'
import type { AdminDb } from './store'
import { getTenant } from './tenants'
import { ForbiddenError } from './errors'
import { getMembership } from './memberships'

/**
 * Consultas administrativas escopadas — nunca cruzam tenants.
 * Autorização fina (Clerk) chega em #21; aqui o escopo é por tenant_id explícito
 * e membership ativo quando `viewerClerkUserId` é fornecido.
 */
export function adminTenantSnapshot(
  db: AdminDb,
  tenantId: string,
  opts: { viewerClerkUserId?: string; requireOwner?: boolean } = {},
) {
  assertAdminSchemaReady(db)
  const tenant = getTenant(db, tenantId)
  if (!tenant) return null

  if (opts.viewerClerkUserId) {
    const membership = getMembership(db, tenantId, opts.viewerClerkUserId)
    if (!membership || membership.status !== 'active') {
      throw new ForbiddenError('tenant_scope_denied', 'Sem membership ativo neste tenant')
    }
    if (opts.requireOwner && membership.role !== 'owner') {
      throw new ForbiddenError('owner_required', 'Owner ativo do tenant exigido')
    }
  }

  return {
    tenant,
    members: listMembersForTenant(db, tenantId),
    pendingInvitations: listPendingInvitationsForTenant(db, tenantId),
    recentAudit: listAuditForTenant(db, tenantId, { limit: 50 }),
  }
}

export function adminUserTenants(db: AdminDb, clerkUserId: string) {
  assertAdminSchemaReady(db)
  return listActiveMembershipsForUser(db, clerkUserId)
}
