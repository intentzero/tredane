/**
 * Rotas pedidos de suporte + aprovação do owner (#26 / DEC-029–031).
 * Sem UI (#22); API + e-mail simulado + fan-out owners + testes sintéticos.
 * Ativação de sessão/handoff fica na #27.
 */
import { Hono } from 'hono'
import type { Clock } from '../db/clock'
import { systemClock } from '../db/clock'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../db/admin'
import {
  requireClinicPermission,
  requirePlatformPermission,
} from '../auth/authorize'
import {
  authErrorResponse,
  requireAuth,
  requireSuperadmin,
  requireTenantAccess,
  type AuthEnv,
} from '../auth/middleware'
import { isAuthError } from '../auth/errors'
import type { AdminDb } from '../db/admin/store'
import type { WorkerBindings } from '../worker/bindings'
import {
  createSimulatedEmailTransport,
  type EmailTransport,
  type SimulatedEmailTransport,
} from '../email'
import type { VerifiedEmailReader } from '../auth/verified-email'
import {
  createDoEventPublisher,
  type ClinicEventPublisher,
} from '../realtime'
import {
  createPendingSupportRequest,
  decideSupportRequest,
  loadSupportRequestForOwner,
  loadSupportRequestsForOwner,
  type SupportServices,
} from './service'
import {
  d1CreateSupportRequest,
  d1DecideSupportRequest,
  d1GetSupportRequest,
  d1ListSupportRequests,
} from './d1-ops'
import { serializeSupportRequest } from './serialize'

type SupportEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type SupportRouteOptions = {
  syncAdminDbFactory?: (env: WorkerBindings) => AdminDb | null
  clockFactory?: () => Clock
  emailFactory?: (env: WorkerBindings) => EmailTransport
  appBaseUrlFactory?: (env: WorkerBindings) => string
  eventPublisherFactory?: (env: WorkerBindings) => ClinicEventPublisher
  verifiedEmailFactory?: (env: WorkerBindings, c: { get: (k: string) => unknown }) => VerifiedEmailReader | null
  onSimulatedTransport?: (transport: SimulatedEmailTransport) => void
}

function supportErrorResponse(
  c: { json: (body: unknown, status?: number) => Response },
  err: unknown,
): Response {
  if (isAuthError(err)) return authErrorResponse(c, err)
  if (err instanceof ForbiddenError) {
    return c.json({ error: err.code }, 403)
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: err.code }, 404)
  }
  if (err instanceof ConflictError) {
    return c.json({ error: err.code }, 409)
  }
  return c.json(
    { error: err instanceof Error ? err.message : 'support_error' },
    400,
  )
}

function resolveEmail(
  env: WorkerBindings,
  opts: SupportRouteOptions,
  clock: Clock,
): EmailTransport {
  const email =
    opts.emailFactory?.(env)
    ?? createSimulatedEmailTransport({ clock })
  if (
    opts.onSimulatedTransport
    && email.name === 'simulated'
    && 'mailbox' in email
  ) {
    opts.onSimulatedTransport(email as SimulatedEmailTransport)
  }
  return email
}

function resolveAppBaseUrl(env: WorkerBindings, opts: SupportRouteOptions): string {
  return (
    opts.appBaseUrlFactory?.(env)
    ?? env.APP_BASE_URL
    ?? 'http://localhost:5173'
  )
}

function resolveEvents(
  env: WorkerBindings,
  opts: SupportRouteOptions,
): ClinicEventPublisher {
  return opts.eventPublisherFactory?.(env) ?? createDoEventPublisher(env)
}

function noopEvents(): ClinicEventPublisher {
  return {
    async publishTenantEvent() {
      return { ok: true, seq: 0, delivered: [], revoked: [] }
    },
  }
}

function resolveVerifiedEmails(
  c: { env: WorkerBindings; get: (k: string) => unknown },
  opts: SupportRouteOptions,
): VerifiedEmailReader | null {
  if (opts.verifiedEmailFactory) {
    return opts.verifiedEmailFactory(c.env, c)
  }
  const services = c.get('authServices') as { verifiedEmails?: VerifiedEmailReader } | undefined
  return services?.verifiedEmails ?? null
}

export function createSupportRoutes(opts: SupportRouteOptions = {}): Hono<SupportEnv> {
  const routes = new Hono<SupportEnv>()

  routes.post('/api/platform/support-requests', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.support.request')
      const body = (await c.req.json().catch(() => ({}))) as {
        tenantId?: string
        subjectClerkUserId?: string
        reason?: string
        scope?: string
      }
      const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : ''
      const subjectClerkUserId =
        typeof body.subjectClerkUserId === 'string' ? body.subjectClerkUserId.trim() : ''
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      const scope = typeof body.scope === 'string' ? body.scope.trim() : ''
      if (!tenantId || !subjectClerkUserId || !reason || !scope) {
        return c.json({ error: 'invalid_body' }, 400)
      }

      const clock = opts.clockFactory?.() ?? systemClock
      const email = resolveEmail(c.env, opts, clock)
      const events = resolveEvents(c.env, opts)
      const verifiedEmails = resolveVerifiedEmails(c, opts)
      if (!verifiedEmails) {
        return c.json({ error: 'verified_email_reader_unavailable' }, 503)
      }

      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
      if (syncDb) {
        const services: SupportServices = {
          db: syncDb,
          clock,
          email,
          appBaseUrl: resolveAppBaseUrl(c.env, opts),
          verifiedEmails,
          events: events ?? noopEvents(),
        }
        const result = await createPendingSupportRequest(services, {
          tenantId,
          actorClerkUserId: principal.clerkUserId,
          subjectClerkUserId,
          reason,
          scope,
        })
        c.header('Cache-Control', 'no-store')
        return c.json(
          {
            request: serializeSupportRequest(result.request),
            emailsQueued: result.emailsQueued,
            emailsSent: result.emailsSent,
            realtimeNotified: result.realtimeNotified,
            /** #26: aprovação ≠ ativação — sem handoff/sessão. */
            accessGranted: false,
          },
          201,
        )
      }

      const result = await d1CreateSupportRequest(c.env.DB, {
        tenantId,
        actorClerkUserId: principal.clerkUserId,
        subjectClerkUserId,
        reason,
        scope,
        now: clock.nowMs(),
        email,
        verifiedEmails,
        events,
        appBaseUrl: resolveAppBaseUrl(c.env, opts),
      })
      c.header('Cache-Control', 'no-store')
      return c.json(
        {
          request: serializeSupportRequest(result.request),
          emailsQueued: result.emailsQueued,
          emailsSent: result.emailsSent,
          realtimeNotified: result.realtimeNotified,
          accessGranted: false,
        },
        201,
      )
    } catch (err) {
      return supportErrorResponse(c, err)
    }
  })

  routes.get('/api/platform/support-requests/:id', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.support.request')
      const id = c.req.param('id')
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
      if (syncDb) {
        const { getSupportRequest } = await import('../db/admin')
        const row = getSupportRequest(syncDb, id)
        if (!row) return c.json({ error: 'support_request_not_found' }, 404)
        c.header('Cache-Control', 'no-store')
        return c.json({ request: serializeSupportRequest(row) })
      }
      const row = await d1GetSupportRequest(c.env.DB, id)
      if (!row) return c.json({ error: 'support_request_not_found' }, 404)
      c.header('Cache-Control', 'no-store')
      return c.json({ request: serializeSupportRequest(row) })
    } catch (err) {
      return supportErrorResponse(c, err)
    }
  })

  routes.get(
    '/api/tenants/:tenantId/support-requests',
    requireAuth(),
    requireTenantAccess({}),
    async (c) => {
      try {
        const ctx = c.get('tenantContext')
        if (!ctx) return c.json({ error: 'tenant_access_denied' }, 403)
        requireClinicPermission(ctx, 'clinic.support.decide')
        const status = c.req.query('status') as
          | 'pending'
          | 'approved'
          | 'rejected'
          | 'expired'
          | 'cancelled'
          | undefined
        const clock = opts.clockFactory?.() ?? systemClock
        const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
        if (syncDb) {
          const services: SupportServices = {
            db: syncDb,
            clock,
            email: resolveEmail(c.env, opts, clock),
            appBaseUrl: resolveAppBaseUrl(c.env, opts),
            verifiedEmails: resolveVerifiedEmails(c, opts)!,
            events: noopEvents(),
          }
          const rows = loadSupportRequestsForOwner(services, ctx.tenantId, {
            status: status && status.length > 0 ? status : undefined,
          })
          c.header('Cache-Control', 'no-store')
          return c.json({
            tenantId: ctx.tenantId,
            requests: rows.map(serializeSupportRequest),
          })
        }
        const rows = await d1ListSupportRequests(c.env.DB, ctx.tenantId, {
          status,
          now: clock.nowMs(),
        })
        c.header('Cache-Control', 'no-store')
        return c.json({
          tenantId: ctx.tenantId,
          requests: rows.map(serializeSupportRequest),
        })
      } catch (err) {
        return supportErrorResponse(c, err)
      }
    },
  )

  routes.get(
    '/api/tenants/:tenantId/support-requests/:id',
    requireAuth(),
    requireTenantAccess({}),
    async (c) => {
      try {
        const ctx = c.get('tenantContext')
        if (!ctx) return c.json({ error: 'tenant_access_denied' }, 403)
        requireClinicPermission(ctx, 'clinic.support.decide')
        const id = c.req.param('id')
        const clock = opts.clockFactory?.() ?? systemClock
        const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
        if (syncDb) {
          const services: SupportServices = {
            db: syncDb,
            clock,
            email: resolveEmail(c.env, opts, clock),
            appBaseUrl: resolveAppBaseUrl(c.env, opts),
            verifiedEmails: resolveVerifiedEmails(c, opts)!,
            events: noopEvents(),
          }
          const row = loadSupportRequestForOwner(services, ctx.tenantId, id)
          c.header('Cache-Control', 'no-store')
          return c.json({ request: serializeSupportRequest(row) })
        }
        const row = await d1GetSupportRequest(c.env.DB, id)
        if (!row || row.tenantId !== ctx.tenantId) {
          return c.json({ error: 'support_request_not_found' }, 404)
        }
        const expired = await d1ListSupportRequests(c.env.DB, ctx.tenantId, {
          now: clock.nowMs(),
        })
        const current = expired.find((r) => r.id === id) ?? row
        c.header('Cache-Control', 'no-store')
        return c.json({ request: serializeSupportRequest(current) })
      } catch (err) {
        return supportErrorResponse(c, err)
      }
    },
  )

  routes.post(
    '/api/tenants/:tenantId/support-requests/:id/decision',
    requireAuth(),
    requireTenantAccess({}),
    async (c) => {
      try {
        const ctx = c.get('tenantContext')
        if (!ctx) return c.json({ error: 'tenant_access_denied' }, 403)
        requireClinicPermission(ctx, 'clinic.support.decide')
        const principal = c.get('principal')
        const id = c.req.param('id')
        const body = (await c.req.json().catch(() => ({}))) as {
          decision?: string
        }
        const decision = body.decision === 'approve' || body.decision === 'reject'
          ? body.decision
          : null
        if (!decision) {
          return c.json({ error: 'invalid_decision' }, 400)
        }

        const clock = opts.clockFactory?.() ?? systemClock
        const events = resolveEvents(c.env, opts)
        const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
        if (syncDb) {
          const services: SupportServices = {
            db: syncDb,
            clock,
            email: resolveEmail(c.env, opts, clock),
            appBaseUrl: resolveAppBaseUrl(c.env, opts),
            verifiedEmails: resolveVerifiedEmails(c, opts)!,
            events,
          }
          const result = await decideSupportRequest(services, {
            tenantId: ctx.tenantId,
            requestId: id,
            ownerClerkUserId: principal.clerkUserId,
            decision,
          })
          c.header('Cache-Control', 'no-store')
          return c.json({
            request: serializeSupportRequest(result.request),
            realtimeNotified: result.realtimeNotified,
            accessGranted: false,
            session: null,
            handoff: null,
          })
        }

        const result = await d1DecideSupportRequest(c.env.DB, {
          tenantId: ctx.tenantId,
          requestId: id,
          ownerClerkUserId: principal.clerkUserId,
          decision,
          now: clock.nowMs(),
          events,
        })
        c.header('Cache-Control', 'no-store')
        return c.json({
          request: serializeSupportRequest(result.request),
          realtimeNotified: result.realtimeNotified,
          accessGranted: false,
          session: null,
          handoff: null,
        })
      } catch (err) {
        return supportErrorResponse(c, err)
      }
    },
  )

  return routes
}
