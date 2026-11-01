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
  promoteAttendantToOwner,
  demoteOwnerToAttendant,
} from '../db/admin'
import { newId } from '../db/admin/ids'
import { requireClinicPermission } from '../auth/authorize'
import type { Permission } from '../auth/types'
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
  env: WorkerBindings | undefined,
  opts: TeamRouteOptions,
  clock: Clock,
): EmailTransport {
  const email =
    opts.emailFactory?.((env ?? {}) as WorkerBindings)
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

function resolveAppBaseUrl(env: WorkerBindings | undefined, opts: TeamRouteOptions): string {
  return (
    opts.appBaseUrlFactory?.((env ?? {}) as WorkerBindings)
    ?? env?.APP_BASE_URL
    ?? 'http://localhost:5173'
  )
}

function resolveTeamServices(
  env: WorkerBindings | undefined,
  opts: TeamRouteOptions,
): TeamServices | null {
  const db = opts.syncAdminDbFactory?.((env ?? {}) as WorkerBindings) ?? null
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

        const activeOwnerCount = snap.members.filter(
          (m) => m.role === 'owner' && m.status === 'active',
        ).length

        // DEC-102: enriquecer nome + e-mail no Worker (sem cache D1 neste recorte).
        const profileReader = c.get('authServices').staffProfiles
        const profiles = profileReader
          ? await profileReader.readStaffProfiles(snap.members.map((m) => m.clerkUserId))
          : new Map()

        c.header('Cache-Control', 'no-store')
        return c.json({
          tenantId: ctx.tenantId,
          members: snap.members.map((m) => {
            const profile = profiles.get(m.clerkUserId)
            return serializeTeamMember(m, {
              callerIsOwner,
              activeOwnerCount,
              displayName: profile?.displayName ?? null,
              email: profile?.email ?? null,
            })
          }),
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

      const body = await c.req
        .json<{ email?: string; role?: string }>()
        .catch(() => null)
      const email = body?.email?.trim()
      if (!email) return c.json({ error: 'email_required' }, 400)

      const roleRaw = body?.role?.trim()
      if (roleRaw && roleRaw !== 'attendant' && roleRaw !== 'owner') {
        return c.json({ error: 'invalid_invitation_role' }, 400)
      }
      const role = roleRaw === 'owner' ? 'owner' : 'attendant'
      const invitePermission: Permission =
        role === 'owner'
          ? 'clinic.members.invite_owner'
          : 'clinic.members.invite_attendant'
      try {
        requireClinicPermission(ctx, invitePermission)
      } catch (err) {
        return authErrorResponse(c, err)
      }

      const services = resolveTeamServices(c.env, opts)
      const clock = opts.clockFactory?.() ?? systemClock

      try {
        if (services) {
          const result = await inviteAttendant(services, {
            tenantId: ctx.tenantId,
            email,
            issuedByClerkUserId: principal.clerkUserId,
            role,
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
            role,
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
          role: result.invitation.role,
          status: 'active',
        },
      })
    } catch (err) {
      return teamErrorResponse(c, err)
    }
  })

  /** DEC-103: promove attendant ativo → owner. */
  routes.post(
    '/api/tenants/:tenantId/members/:clerkUserId/promote',
    requireAuth(),
    requireTenantAccess({}),
    async (c) => {
      const ctx = c.get('tenantContext')
      const principal = c.get('principal')
      if (!ctx) return c.json({ error: 'tenant_access_denied' }, 403)
      try {
        requireClinicPermission(ctx, 'clinic.members.promote_to_owner')
      } catch (err) {
        return authErrorResponse(c, err)
      }

      const targetUserId = c.req.param('clerkUserId')
      if (!targetUserId) return c.json({ error: 'member_required' }, 400)

      const services = resolveTeamServices(c.env, opts)
      try {
        if (services) {
          const membership = promoteAttendantToOwner(services.db, services.clock, {
            tenantId: ctx.tenantId,
            clerkUserId: targetUserId,
            actorClerkUserId: principal.clerkUserId,
          })
          c.header('Cache-Control', 'no-store')
          return c.json({
            membership: {
              tenantId: membership.tenantId,
              clerkUserId: membership.clerkUserId,
              role: membership.role,
              status: membership.status,
            },
          })
        }

        const membership = await d1PromoteAttendant(c.env.DB, {
          tenantId: ctx.tenantId,
          clerkUserId: targetUserId,
          actorClerkUserId: principal.clerkUserId,
          now: (opts.clockFactory?.() ?? systemClock).nowMs(),
        })
        c.header('Cache-Control', 'no-store')
        return c.json({ membership })
      } catch (err) {
        return teamErrorResponse(c, err)
      }
    },
  )

  /** DEC-103: despromove owner → attendant; protege o último. */
  routes.post(
    '/api/tenants/:tenantId/members/:clerkUserId/demote',
    requireAuth(),
    requireTenantAccess({}),
    async (c) => {
      const ctx = c.get('tenantContext')
      const principal = c.get('principal')
      if (!ctx) return c.json({ error: 'tenant_access_denied' }, 403)
      try {
        requireClinicPermission(ctx, 'clinic.members.demote_owner')
      } catch (err) {
        return authErrorResponse(c, err)
      }

      const targetUserId = c.req.param('clerkUserId')
      if (!targetUserId) return c.json({ error: 'member_required' }, 400)

      const services = resolveTeamServices(c.env, opts)
      try {
        if (services) {
          const membership = demoteOwnerToAttendant(services.db, services.clock, {
            tenantId: ctx.tenantId,
            clerkUserId: targetUserId,
            actorClerkUserId: principal.clerkUserId,
          })
          c.header('Cache-Control', 'no-store')
          return c.json({
            membership: {
              tenantId: membership.tenantId,
              clerkUserId: membership.clerkUserId,
              role: membership.role,
              status: membership.status,
            },
          })
        }

        const membership = await d1DemoteOwner(c.env.DB, {
          tenantId: ctx.tenantId,
          clerkUserId: targetUserId,
          actorClerkUserId: principal.clerkUserId,
          now: (opts.clockFactory?.() ?? systemClock).nowMs(),
        })
        c.header('Cache-Control', 'no-store')
        return c.json({ membership })
      } catch (err) {
        return teamErrorResponse(c, err)
      }
    },
  )

  return routes
}

async function d1PromoteAttendant(
  db: D1Database,
  input: {
    tenantId: string
    clerkUserId: string
    actorClerkUserId: string
    now: number
  },
): Promise<{
  tenantId: string
  clerkUserId: string
  role: string
  status: string
}> {
  const existing = await db
    .prepare(
      `SELECT role, status FROM tenant_memberships
       WHERE tenant_id = ? AND clerk_user_id = ?`,
    )
    .bind(input.tenantId, input.clerkUserId)
    .first<{ role: string; status: string }>()
  if (!existing || existing.status !== 'active') {
    throw new NotFoundError('membership_not_found', 'Membership ativo inexistente')
  }
  if (existing.role === 'owner') {
    return {
      tenantId: input.tenantId,
      clerkUserId: input.clerkUserId,
      role: 'owner',
      status: 'active',
    }
  }
  if (existing.role !== 'attendant') {
    throw new ConflictError('not_an_attendant', 'Só atendentes podem ser promovidos a responsável')
  }
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
  await db
    .prepare(
      `INSERT INTO central_audit_events (
        id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
        action, object_type, object_id, outcome, support_session_id, metadata_json
      ) VALUES (?, ?, ?, ?, ?, 'owner.promote', 'tenant_membership', ?, 'success', NULL, ?)`,
    )
    .bind(
      newId('aud'),
      input.now,
      input.actorClerkUserId,
      input.clerkUserId,
      input.tenantId,
      `${input.tenantId}:${input.clerkUserId}`,
      JSON.stringify({ from: 'attendant', to: 'owner', via: 'clinic_equipe' }),
    )
    .run()
  return {
    tenantId: input.tenantId,
    clerkUserId: input.clerkUserId,
    role: 'owner',
    status: 'active',
  }
}

async function d1DemoteOwner(
  db: D1Database,
  input: {
    tenantId: string
    clerkUserId: string
    actorClerkUserId: string
    now: number
  },
): Promise<{
  tenantId: string
  clerkUserId: string
  role: string
  status: string
}> {
  const existing = await db
    .prepare(
      `SELECT role, status FROM tenant_memberships
       WHERE tenant_id = ? AND clerk_user_id = ?`,
    )
    .bind(input.tenantId, input.clerkUserId)
    .first<{ role: string; status: string }>()
  if (!existing || existing.status !== 'active') {
    throw new NotFoundError('membership_not_found', 'Membership inexistente')
  }
  if (existing.role !== 'owner') {
    throw new ConflictError('not_an_owner', 'Só responsáveis podem ser despromovidos')
  }
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
      'Não é permitido despromover o último owner ativo',
    )
  }
  const updated = await db
    .prepare(
      `UPDATE tenant_memberships SET role = 'attendant'
       WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active' AND role = 'owner'`,
    )
    .bind(input.tenantId, input.clerkUserId)
    .run()
  if (!updated.meta.changes || updated.meta.changes < 1) {
    throw new ConflictError('owner_demote_conflict', 'Despromoção não aplicada')
  }
  await db
    .prepare(
      `INSERT INTO central_audit_events (
        id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
        action, object_type, object_id, outcome, support_session_id, metadata_json
      ) VALUES (?, ?, ?, ?, ?, 'owner.demote', 'tenant_membership', ?, 'success', NULL, ?)`,
    )
    .bind(
      newId('aud'),
      input.now,
      input.actorClerkUserId,
      input.clerkUserId,
      input.tenantId,
      `${input.tenantId}:${input.clerkUserId}`,
      JSON.stringify({ from: 'owner', to: 'attendant' }),
    )
    .run()
  return {
    tenantId: input.tenantId,
    clerkUserId: input.clerkUserId,
    role: 'attendant',
    status: 'active',
  }
}
