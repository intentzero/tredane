import { Hono } from 'hono'
import {
  listPlatformTenants,
  listPrincipalTenants,
  requireClinicPermission,
} from './authorize'
import { authErrorResponse, requireAuth, requireSuperadmin, requireTenantAccess, type AuthEnv } from './middleware'
import { isAuthError } from './errors'

/**
 * Rotas de identidade e autorização (#21).
 * Sem UI de login (#22) e sem WebSockets de produto (#23).
 */
export function createAuthRoutes(): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>()

  routes.get('/api/me', requireAuth(), async (c) => {
    const principal = c.get('principal')
    c.header('Cache-Control', 'no-store')
    return c.json({
      kind: principal.kind,
      clerkUserId: principal.clerkUserId,
      sessionId: principal.sessionId,
      // Superadmin só é afirmado em rotas que revalidam privateMetadata.
      isSuperadmin: false,
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

  routes.get('/api/platform/tenants', requireSuperadmin(), async (c) => {
    try {
      const services = c.get('authServices')
      const principal = c.get('principal')
      const tenants = await listPlatformTenants(services, principal)
      c.header('Cache-Control', 'no-store')
      return c.json({
        tenants: tenants.map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
        })),
      })
    } catch (err) {
      if (isAuthError(err)) return authErrorResponse(c, err)
      return authErrorResponse(c, err)
    }
  })

  return routes
}
