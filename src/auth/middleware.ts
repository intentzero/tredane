import type { MiddlewareHandler } from 'hono'
import { asyncFromSync, fromD1, type AsyncAdminDb } from '../db/admin/async-store'
import type { AdminDb } from '../db/admin/store'
import {
  authenticateHuman,
  authenticateHumanWithOptionalSuperadmin,
  resolveTenantContext,
  type AuthServices,
} from './authorize'
import { isAuthError } from './errors'
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
