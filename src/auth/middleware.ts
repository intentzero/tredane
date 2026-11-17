import type { MiddlewareHandler } from 'hono'
import { asyncFromSync, fromD1, type AsyncAdminDb } from '../db/admin/async-store'
import type { AdminDb } from '../db/admin/store'
import {
  authenticateHuman,
  authenticateHumanWithOptionalSuperadmin,
  resolveTenantContext,
  type AuthServices,
} from './authorize'
import { AuthError, isAuthError } from './errors'
import { systemClock } from '../db/clock'
import { supportSessionsEnabled } from '../support/flag'
import { buildSupportClearCookie, parseSupportCookie } from '../support/cookie'
import {
  matchSupportReadRoute,
  matchSupportTicketRoute,
  recordSupportAccess,
  redactPhones,
  resolveSupportTenantContext,
  supportReadTarget,
} from '../support/overlay'
import type { HumanPrincipal, TenantContext } from './types'

export type AuthEnv = {
  Variables: {
    authServices: AuthServices
    principal: HumanPrincipal
    tenantContext?: TenantContext
  }
  Bindings: {
    DB: D1Database
    CLERK_SECRET_KEY?: string
    CLERK_PUBLISHABLE_KEY?: string
    CLERK_JWT_KEY?: string
    CLERK_AUTHORIZED_PARTIES?: string
    /** `synthetic` só em development/test; staging/prod devem usar `clerk`. */
    AUTH_MODE?: string
    ENVIRONMENT?: string
    /** ADR-0017 §7: ligar as sessões de suporte em produção (`"true"`). */
    SUPPORT_SESSIONS_ENABLED?: string
  }
}

export type AuthDepsFactory = (env: AuthEnv['Bindings']) => AuthServices

export function createAuthServicesMiddleware(
  factory: AuthDepsFactory,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    c.set('authServices', factory(c.env))
    await next()
  }
}

export function requireAuth(): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    try {
      const services = c.get('authServices')
      const principal = await authenticateHuman(services, c.req.raw)
      c.set('principal', principal)
      await next()
    } catch (err) {
      return authErrorResponse(c, err)
    }
  }
}

export function requireSuperadmin(): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    try {
      const services = c.get('authServices')
      const principal = await authenticateHumanWithOptionalSuperadmin(
        services,
        c.req.raw,
        { verifySuperadmin: true },
      )
      c.set('principal', principal)
      await next()
    } catch (err) {
      return authErrorResponse(c, err)
    }
  }
}

export function requireTenantAccess(opts: {
  param?: string
  /** Header opcional com role reivindicada pelo cliente — se diverge do D1, 403. */
  claimedRoleHeader?: string
}): MiddlewareHandler<AuthEnv> {
  const param = opts.param ?? 'tenantId'
  const claimedHeader = opts.claimedRoleHeader ?? 'X-Claimed-Role'
  return async (c, next) => {
    try {
      const services = c.get('authServices')
      const principal = c.get('principal')
      const tenantId = c.req.param(param)
      if (!tenantId) {
        return c.json({ error: 'tenant_required' }, 400)
      }
      const claimed = c.req.header(claimedHeader)

      // Sessão de suporte (ADR-0017): só se o interruptor estiver ligado e o pedido trouxer o cookie.
      const supportToken = supportSessionsEnabled(c.env)
        ? parseSupportCookie(c.req.header('Cookie') ?? null)
        : null
      if (supportToken) {
        const clock = services.clock ?? systemClock
        const secure = c.env?.ENVIRONMENT !== 'development'
        let resolved: Awaited<ReturnType<typeof resolveSupportTenantContext>>
        try {
          resolved = await resolveSupportTenantContext(services, principal, tenantId, supportToken, clock)
        } catch (err) {
          // Cookie inválido, expirado ou de outra clínica: recusa e limpa-o, para não bloquear o resto da navegação.
          c.header('Set-Cookie', buildSupportClearCookie({ secure }))
          throw err
        }
        const method = c.req.method
        const pathname = new URL(c.req.url).pathname
        const route = matchSupportReadRoute(method, pathname) ?? matchSupportTicketRoute(method, pathname)
        const nowMs = clock.nowMs()
        if (!route) {
          // Deny-by-default: só `GET` às rotas da lista. Tentativas ficam auditadas, agregadas por minuto.
          const key = pathname.replace(/^\/api\/tenants\/[^/]+\/?/, '').split('/').slice(0, 2).join('/') || 'root'
          await recordSupportAccess(services.adminDb, { session: resolved.session, route: key, method, outcome: 'denied', nowMs })
          return c.json({ error: method === 'GET' || method === 'HEAD' ? 'support_route_blocked' : 'support_write_blocked' }, 403)
        }
        if (claimed != null && claimed !== '' && claimed !== resolved.ctx.role) {
          throw new AuthError('forged_role_rejected', 'Role forjada rejeitada', 403)
        }
        c.set('tenantContext', resolved.ctx)
        await recordSupportAccess(services.adminDb, {
          session: resolved.session,
          route,
          method,
          outcome: 'success',
          nowMs,
          target: supportReadTarget(method, pathname),
        })
        await next()
        // O suporte nunca vê o telefone inteiro de uma cliente (Q-SUP-01).
        const res = c.res
        if (res.headers.get('content-type')?.includes('application/json')) {
          const body = (await res.clone().json()) as unknown
          const headers = new Headers(res.headers)
          headers.delete('content-length')
          c.res = new Response(JSON.stringify(redactPhones(body)), { status: res.status, headers })
        }
        return
      }

      const ctx = await resolveTenantContext(services, principal, tenantId, claimed)
      c.set('tenantContext', ctx)
      await next()
    } catch (err) {
      return authErrorResponse(c, err)
    }
  }
}

export function authErrorResponse(
  c: { json: (body: unknown, status: 401 | 403 | 500) => Response },
  err: unknown,
): Response {
  if (isAuthError(err)) {
    return c.json({ error: err.code }, err.status)
  }
  return c.json({ error: 'authority_verification_failed' }, 403)
}

/** Helpers para montar AsyncAdminDb em testes ou Worker. */
export function adminDbFromEnv(env: { DB: D1Database }): AsyncAdminDb {
  return fromD1(env.DB)
}

export function adminDbFromSync(db: AdminDb): AsyncAdminDb {
  return asyncFromSync(db)
}
