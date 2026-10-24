/**
 * Rotas Equipe / convites (#25 / DEC-021–026).
 * Sem UI de biblioteca (#22); API + e-mail simulado + testes sintéticos.
 */
import { Hono } from 'hono'
import type { Clock } from '../db/clock'
import { systemClock } from '../db/clock'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../db/admin'
import { requireClinicPermission } from '../auth/authorize'
import {
  authErrorResponse,
  requireAuth,
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
import {
  acceptAttendantInvite,
  cancelAttendantInvite,
  inviteAttendant,
  loadTeamSnapshot,
  peekInvitation,
  resendAttendantInvite,
  type TeamServices,
} from './service'
import {
  d1AcceptInvitation,
  d1CancelInvitation,
  d1CreateInvitation,
  d1GetInvitation,
  d1ListTeam,
  d1ResendInvitation,
} from './d1-ops'
import {
  conflictRetryHints,
  serializeInvitation,
  serializeTeamMember,
} from './serialize'

type TeamEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type TeamRouteOptions = {
  syncAdminDbFactory?: (env: WorkerBindings) => AdminDb | null
  clockFactory?: () => Clock
  emailFactory?: (env: WorkerBindings) => EmailTransport
  appBaseUrlFactory?: (env: WorkerBindings) => string
  /** Expõe mailbox simulado aos testes (quando o transport é simulated). */
  onSimulatedTransport?: (transport: SimulatedEmailTransport) => void
}

function teamErrorResponse(
  c: { json: (body: unknown, status?: number) => Response },
  err: unknown,
  hints: Record<string, unknown> = {},
): Response {
  if (isAuthError(err)) return authErrorResponse(c, err)
  if (err instanceof ForbiddenError) {
    return c.json({ error: err.code, ...hints }, 403)
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: err.code, ...hints }, 404)
  }
  if (err instanceof ConflictError) {
    const status =
      err.code === 'invitation_resend_cooldown'
      || err.code === 'invitation_resend_quota'
        ? 429
        : 409
    return c.json({ error: err.code, ...hints }, status)
  }
  return c.json(
    { error: err instanceof Error ? err.message : 'team_error' },
    400,
  )
}

function resolveEmail(
  env: WorkerBindings,
  opts: TeamRouteOptions,
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

function resolveAppBaseUrl(env: WorkerBindings, opts: TeamRouteOptions): string {
  return (
    opts.appBaseUrlFactory?.(env)
    ?? env.APP_BASE_URL
    ?? 'http://localhost:5173'
  )
}

function resolveTeamServices(
  env: WorkerBindings,
  opts: TeamRouteOptions,
): TeamServices | null {
  const db = opts.syncAdminDbFactory?.(env) ?? null
  if (!db) return null
  const clock = opts.clockFactory?.() ?? systemClock
  return {
    db,
    clock,
    email: resolveEmail(env, opts, clock),
    appBaseUrl: resolveAppBaseUrl(env, opts),
  }
}

async function resolveVerifiedEmail(
  c: {
    get: (k: 'authServices') => AuthEnv['Variables']['authServices']
    req: { header: (name: string) => string | undefined }
  },
  clerkUserId: string,
): Promise<{ ok: true; email: string } | { ok: false; code: string }> {
  const authServices = c.get('authServices')
  const emailReader = authServices.verifiedEmails
  if (!emailReader) {
    return { ok: false, code: 'verified_email_reader_missing' }
  }

  let verified = await emailReader.readPrimaryVerifiedEmail(clerkUserId)
  const headerOverride = c.req.header('X-Synth-Verified-Email')
  if (headerOverride !== undefined) {
    const trimmed = headerOverride.trim()
    verified = trimmed
      ? { ok: true, email: trimmed.toLowerCase() }
      : { ok: false, reason: 'unverified' }
  }

  if (!verified.ok) {
    const code =
      verified.reason === 'unverified'
        ? 'invitation_email_unverified'
        : verified.reason === 'unavailable'
          ? 'verified_email_unavailable'
          : 'invitation_email_missing'
    return { ok: false, code }
  }
  return { ok: true, email: verified.email }
}

export function createTeamRoutes(opts: TeamRouteOptions = {}): Hono<TeamEnv> {
  const routes = new Hono<TeamEnv>()

  routes.get(
    '/api/tenants/:tenantId/team',
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

      const callerIsOwner = ctx.role === 'owner'
      const services = resolveTeamServices(c.env, opts)
      const clock = opts.clockFactory?.() ?? systemClock
      const now = clock.nowMs()

      try {
        const snap = services
          ? loadTeamSnapshot(services, ctx.tenantId)
          : await d1ListTeam(c.env.DB, ctx.tenantId, now)

        c.header('Cache-Control', 'no-store')
        return c.json({
          tenantId: ctx.tenantId,
          members: snap.members.map((m) =>
            serializeTeamMember(m, { callerIsOwner }),
          ),
          invitations: snap.invitations.map((inv) =>
            serializeInvitation(inv, {
              nowMs: now,
              resendCountInWindow: snap.resendCounts.get(inv.id) ?? 0,
              callerIsOwner,
            }),
          ),
        })
      } catch (err) {
        return teamErrorResponse(c, err)
      }
    },
  )

  routes.post(
    '/api/tenants/:tenantId/invitations',
    requireAuth(),
    requireTenantAccess({}),
    async (c) => {
      const ctx = c.get('tenantContext')
      const principal = c.get('principal')
      if (!ctx) return c.json({ error: 'tenant_access_denied' }, 403)
      try {
        requireClinicPermission(ctx, 'clinic.members.invite_attendant')
      } catch (err) {
        return authErrorResponse(c, err)
      }

      const body = await c.req.json<{ email?: string }>().catch(() => null)
      const email = body?.email?.trim()
      if (!email) return c.json({ error: 'email_required' }, 400)

      const services = resolveTeamServices(c.env, opts)
      const clock = opts.clockFactory?.() ?? systemClock

      try {
        if (services) {
          const result = await inviteAttendant(services, {
            tenantId: ctx.tenantId,
            email,
            issuedByClerkUserId: principal.clerkUserId,
          })
          c.header('Cache-Control', 'no-store')
          return c.json(
            {
              invitation: serializeInvitation(result.issued.invitation, {
                nowMs: services.clock.nowMs(),
                resendCountInWindow: 0,
                callerIsOwner: true,
              }),
              emailSent: result.emailSent,
              deliveryJobId: result.deliveryJobId,
            },
            201,
          )
        }

        const result = await d1CreateInvitation(
          c.env.DB,
          resolveEmail(c.env, opts, clock),
          {
            tenantId: ctx.tenantId,
            email,
            issuedByClerkUserId: principal.clerkUserId,
            appBaseUrl: resolveAppBaseUrl(c.env, opts),
            now: clock.nowMs(),
          },
        )
        c.header('Cache-Control', 'no-store')
        return c.json(
          {
            invitation: serializeInvitation(result.invitation, {
              nowMs: clock.nowMs(),
              resendCountInWindow: 0,
              callerIsOwner: true,
            }),
            emailSent: result.emailSent,
            deliveryJobId: result.deliveryJobId,
          },
          201,
        )
      } catch (err) {
        return teamErrorResponse(c, err)
      }
    },
  )

  routes.post(
    '/api/tenants/:tenantId/invitations/:invitationId/resend',
    requireAuth(),
    requireTenantAccess({}),
    async (c) => {
      const ctx = c.get('tenantContext')
      const principal = c.get('principal')
      if (!ctx) return c.json({ error: 'tenant_access_denied' }, 403)
      try {
        requireClinicPermission(ctx, 'clinic.members.invite_attendant')
      } catch (err) {
        return authErrorResponse(c, err)
      }

      const invitationId = c.req.param('invitationId')
      const services = resolveTeamServices(c.env, opts)
      const clock = opts.clockFactory?.() ?? systemClock
      const now = clock.nowMs()

      const preview = services
        ? peekInvitation(services.db, invitationId)
        : await d1GetInvitation(c.env.DB, invitationId)
      if (preview && preview.tenantId !== ctx.tenantId) {
        return c.json({ error: 'invitation_not_found' }, 404)
      }

      try {
        if (services) {
          const result = await resendAttendantInvite(services, {
            invitationId,
            actorClerkUserId: principal.clerkUserId,
          })
          if (result.issued.invitation.tenantId !== ctx.tenantId) {
            return c.json({ error: 'invitation_not_found' }, 404)
          }
          c.header('Cache-Control', 'no-store')
          return c.json({
            invitation: serializeInvitation(result.issued.invitation, {
              nowMs: now,
              callerIsOwner: true,
            }),
            emailSent: result.emailSent,
            deliveryJobId: result.deliveryJobId,
          })
        }

        const result = await d1ResendInvitation(
          c.env.DB,
          resolveEmail(c.env, opts, clock),
          {
            invitationId,
            actorClerkUserId: principal.clerkUserId,
            tenantId: ctx.tenantId,
            appBaseUrl: resolveAppBaseUrl(c.env, opts),
            now,
          },
        )
        c.header('Cache-Control', 'no-store')
        return c.json({
          invitation: serializeInvitation(result.invitation, {
            nowMs: now,
            callerIsOwner: true,
          }),
          emailSent: result.emailSent,
          deliveryJobId: result.deliveryJobId,
        })
      } catch (err) {
        const hints =
          err instanceof ConflictError
            ? conflictRetryHints(err.code, now, preview ?? undefined)
            : {}
        return teamErrorResponse(c, err, hints)
      }
    },
  )

  routes.post(
    '/api/tenants/:tenantId/invitations/:invitationId/cancel',
    requireAuth(),
    requireTenantAccess({}),
    async (c) => {
      const ctx = c.get('tenantContext')
      const principal = c.get('principal')
      if (!ctx) return c.json({ error: 'tenant_access_denied' }, 403)
      try {
        requireClinicPermission(ctx, 'clinic.members.invite_attendant')
      } catch (err) {
        return authErrorResponse(c, err)
      }

      const invitationId = c.req.param('invitationId')
      const services = resolveTeamServices(c.env, opts)
      const clock = opts.clockFactory?.() ?? systemClock
      const now = clock.nowMs()

      try {
        if (services) {
          const preview = peekInvitation(services.db, invitationId)
          if (!preview || preview.tenantId !== ctx.tenantId) {
            return c.json({ error: 'invitation_not_found' }, 404)
          }
          const cancelled = cancelAttendantInvite(services, {
            invitationId,
            actorClerkUserId: principal.clerkUserId,
          })
          c.header('Cache-Control', 'no-store')
          return c.json({
            invitation: serializeInvitation(cancelled, {
              nowMs: now,
              callerIsOwner: true,
            }),
          })
        }

        const cancelled = await d1CancelInvitation(c.env.DB, {
          invitationId,
          actorClerkUserId: principal.clerkUserId,
          tenantId: ctx.tenantId,
          now,
        })
        c.header('Cache-Control', 'no-store')
        return c.json({
          invitation: serializeInvitation(cancelled, {
            nowMs: now,
            callerIsOwner: true,
          }),
        })
      } catch (err) {
        return teamErrorResponse(c, err)
      }
    },
  )

  /**
   * Aceite: sessão Clerk + e-mail verificado correspondente.
   * Tenant/role do body são ignorados — só o token + e-mail Clerk.
   */
  routes.post('/api/invitations/accept', requireAuth(), async (c) => {
    const principal = c.get('principal')
    const body = await c.req
      .json<{ token?: string; tenantId?: string; role?: string }>()
      .catch(() => null)
    const rawToken = body?.token?.trim()
    if (!rawToken) return c.json({ error: 'token_required' }, 400)

    const verified = await resolveVerifiedEmail(c, principal.clerkUserId)
    if (!verified.ok) {
      return c.json(
        { error: verified.code },
        verified.code === 'verified_email_reader_missing' ? 500 : 403,
      )
    }

    const services = resolveTeamServices(c.env, opts)
    const clock = opts.clockFactory?.() ?? systemClock
    const now = clock.nowMs()

    try {
      const result = services
        ? await acceptAttendantInvite(services, {
            rawToken,
            acceptorClerkUserId: principal.clerkUserId,
            verifiedEmail: verified.email,
          })
        : await d1AcceptInvitation(c.env.DB, {
            rawToken,
            acceptorClerkUserId: principal.clerkUserId,
            verifiedEmail: verified.email,
            now,
          })

      c.header('Cache-Control', 'no-store')
      return c.json({
        invitation: serializeInvitation(result.invitation, {
          nowMs: now,
          callerIsOwner: false,
        }),
        membership: {
          tenantId: result.invitation.tenantId,
          clerkUserId: principal.clerkUserId,
          role: 'attendant',
          status: 'active',
        },
      })
    } catch (err) {
      return teamErrorResponse(c, err)
    }
  })

  return routes
}
