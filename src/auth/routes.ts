import { Hono } from 'hono'
import {
  listPrincipalTenants,
  requireClinicPermission,
} from './authorize'
import { authErrorResponse, requireAuth, requireTenantAccess, type AuthEnv } from './middleware'
import { requireVerifiedSuperadmin } from './superadmin'

/**
 * Rotas de identidade e autorização (#21).
 * Sem UI de login (#22) e sem WebSockets de produto (#23).
 */
export function createAuthRoutes(): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>()

  routes.get('/api/me', requireAuth(), async (c) => {
    const principal = c.get('principal')
    const services = c.get('authServices')
    // Platform Admin UI (DEC-192, #828): o cliente só decide se mostra `/admin`.
    // A autorização real continua em cada rota `/api/platform/*` (`requireSuperadmin`).
    // Fail closed: qualquer falha de leitura do Clerk → false, nunca true.
    let isSuperadmin = false
    try {
      await requireVerifiedSuperadmin(services.authority, principal.clerkUserId)
      isSuperadmin = true
    } catch {
      isSuperadmin = false
    }
    c.header('Cache-Control', 'no-store')
    return c.json({
      kind: principal.kind,
      clerkUserId: principal.clerkUserId,
      sessionId: principal.sessionId,
      isSuperadmin,
    })
  })

  routes.get('/api/me/tenants', requireAuth(), async (c) => {
    const services = c.get('authServices')
    const principal = c.get('principal')
    const memberships = await listPrincipalTenants(services, principal)
    c.header('Cache-Control', 'no-store')
    return c.json({
      tenants: memberships.map((m) => ({
        tenantId: m.tenantId,
        name: m.tenantName,
        role: m.role,
        status: m.status,
      })),
    })
  })

  routes.get(
    '/api/tenants/:tenantId/context',
    requireAuth(),
    requireTenantAccess({}),
    async (c) => {
      const ctx = c.get('tenantContext')
      if (!ctx) return c.json({ error: 'tenant_access_denied' }, 403)
      try {
        requireClinicPermission(ctx, 'clinic.context.read')
      } catch (err) {
        return authErrorResponse(c, err)
      }
      c.header('Cache-Control', 'no-store')
      return c.json({
        tenantId: ctx.tenantId,
        name: ctx.tenantName,
        status: ctx.tenantStatus,
        role: ctx.role,
        // ADR-0017: o cliente sabe que está numa sessão de suporte (só leitura) e quando ela acaba.
        ...(ctx.support ? { support: { sessionId: ctx.support.sessionId, expiresAt: ctx.support.expiresAt } } : {}),
      })
    },
  )

  /**
   * Probe de autorização clínica — não é painel de produto.
   * Exige membership ativo; usado pela matriz de permissões HTTP.
   */
  routes.get(
    '/api/tenants/:tenantId/inbox-probe',
    requireAuth(),
    requireTenantAccess({}),
    async (c) => {
      const ctx = c.get('tenantContext')
      if (!ctx) return c.json({ error: 'tenant_access_denied' }, 403)
      try {
        requireClinicPermission(ctx, 'clinic.inbox.read')
      } catch (err) {
        return authErrorResponse(c, err)
      }
      c.header('Cache-Control', 'no-store')
      return c.json({
        tenantId: ctx.tenantId,
        ok: true,
        role: ctx.role,
      })
    },
  )

  /** Configuração da clínica — só owner (DEC-042). */
  routes.post(
    '/api/tenants/:tenantId/config-probe',
    requireAuth(),
    requireTenantAccess({}),
    async (c) => {
      const ctx = c.get('tenantContext')
      if (!ctx) return c.json({ error: 'tenant_access_denied' }, 403)
      try {
        requireClinicPermission(ctx, 'clinic.config.write')
      } catch (err) {
        return authErrorResponse(c, err)
      }
      c.header('Cache-Control', 'no-store')
      return c.json({ tenantId: ctx.tenantId, ok: true })
    },
  )

  // GET/POST /api/platform/* — Platform Admin (#24) em createPlatformRoutes().

  return routes
}
