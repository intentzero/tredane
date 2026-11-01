import {
  listActiveMembershipsForUserAsync,
  listTenantsAsync,
  resolveActiveTenantMembership,
  type AsyncMembershipRow,
  type AsyncTenantMembershipSummary,
  type AsyncTenantRow,
} from '../db/admin/async-queries'
import type { AsyncAdminDb } from '../db/admin/async-store'
import { ForbiddenError } from '../db/admin/errors'
import { AuthError } from './errors'
import { platformAllows, roleAllows } from './permissions'
import { requireSession, type SessionAuthenticator } from './session'
import { requireVerifiedSuperadmin, type AuthorityReader } from './superadmin'
import type { StaffProfileReader } from './staff-profile'
import type { VerifiedEmailReader } from './verified-email'
import type { HumanPrincipal, Permission, TenantContext } from './types'

export type AuthServices = {
  sessions: SessionAuthenticator
  authority: AuthorityReader
  adminDb: AsyncAdminDb
  /** Obrigatório para aceite de convite (#25); opcional noutros fluxos. */
  verifiedEmails?: VerifiedEmailReader
  /** DEC-102: nome + e-mail na lista Equipe (Clerk Backend / sintético). */
  staffProfiles?: StaffProfileReader
}

export async function authenticateHuman(
  services: AuthServices,
  request: Request,
): Promise<HumanPrincipal> {
  const session = requireSession(await services.sessions.authenticateRequest(request))
  return {
    kind: 'human',
    clerkUserId: session.clerkUserId,
    sessionId: session.sessionId,
    isSuperadmin: false,
  }
}

/**
 * Autentica e, se necessário para a rota, revalida superadmin via Backend API.
 * isSuperadmin no principal só fica true após verificação bem-sucedida.
 */
export async function authenticateHumanWithOptionalSuperadmin(
  services: AuthServices,
  request: Request,
  opts: { verifySuperadmin: boolean },
): Promise<HumanPrincipal> {
  const base = await authenticateHuman(services, request)
  if (!opts.verifySuperadmin) return base
  await requireVerifiedSuperadmin(services.authority, base.clerkUserId)
  return { ...base, isSuperadmin: true }
}

export async function listPrincipalTenants(
  services: AuthServices,
  principal: HumanPrincipal,
): Promise<AsyncTenantMembershipSummary[]> {
  return listActiveMembershipsForUserAsync(services.adminDb, principal.clerkUserId)
}

export async function resolveTenantContext(
  services: AuthServices,
  principal: HumanPrincipal,
  tenantId: string,
  /** Role enviada pelo cliente — se presente e divergente, rejeitar (não conceder). */
  clientClaimedRole?: string | null,
): Promise<TenantContext> {
  let resolved: { tenant: AsyncTenantRow; membership: AsyncMembershipRow }
  try {
    resolved = await resolveActiveTenantMembership(
      services.adminDb,
      tenantId,
      principal.clerkUserId,
    )
  } catch (err) {
    if (err instanceof ForbiddenError) {
      throw new AuthError(
        err.code === 'tenant_not_active' ? 'tenant_not_active' : 'tenant_access_denied',
        'Acesso ao tenant negado',
        403,
      )
    }
    throw err
  }

  if (clientClaimedRole != null && clientClaimedRole !== '' && clientClaimedRole !== resolved.membership.role) {
    throw new AuthError(
      'forged_role_rejected',
      'Role forjada rejeitada',
      403,
    )
  }

  return {
    tenantId: resolved.tenant.id,
    role: resolved.membership.role,
    tenantName: resolved.tenant.name,
    tenantStatus: 'active',
  }
}

export function requireClinicPermission(
  ctx: TenantContext,
  permission: Permission,
): void {
  if (!roleAllows(ctx.role, permission)) {
    throw new AuthError('permission_denied', 'Permissão negada', 403)
  }
}

export function requirePlatformPermission(
  principal: HumanPrincipal,
  permission: Permission,
): void {
  if (!principal.isSuperadmin || !platformAllows(true, permission)) {
    throw new AuthError('permission_denied', 'Permissão negada', 403)
  }
}

export async function listPlatformTenants(
  services: AuthServices,
  principal: HumanPrincipal,
): Promise<AsyncTenantRow[]> {
  requirePlatformPermission(principal, 'platform.tenants.read')
  return listTenantsAsync(services.adminDb)
}

/**
 * Integração verificada — stub fail-closed até F3.
 * Qualquer chamada sem verificação real nega.
 */
export function denyUnverifiedIntegration(): never {
  throw new AuthError(
    'integration_unverified',
    'Integração não verificada',
    403,
  )
}
