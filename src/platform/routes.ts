/**
 * Rotas Platform Admin (#24 / DEC-018/020 / REQ-004/006).
 * Sem UI de biblioteca de componentes (#22); API + testes sintéticos.
 * Superadmin verificado no backend; sem acesso clínico implícito.
 */
import { Hono } from 'hono'
import { systemClock, type Clock } from '../db/clock'
import {
  assignOwner,
  createTenantWithOwner,
  listPendingInvitationsForTenant,
  getOpenDeletionCommand,
  getTenant,
  listAuditForTenant,
  listMembersForTenant,
  removeOwner,
  replaceOwner,
  updateTenant,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../db/admin'
import { requirePlatformPermission } from '../auth/authorize'
import {
  authErrorResponse,
  requireSuperadmin,
  type AuthEnv,
} from '../auth/middleware'
import { isAuthError } from '../auth/errors'
import {
  createDoInvalidator,
  type ClinicAccessInvalidator,
  markPendingDeletionAndPropagate,
  reactivateTenantAndPropagate,
  suspendTenantAndPropagate,
} from '../realtime'
import type { FenceSource } from '../realtime/protocol'
import type { AdminDb } from '../db/admin/store'
import type { WorkerBindings } from '../worker/bindings'
import type { MembershipRow } from '../db/admin/memberships'
import { asyncFromSync, fromD1 } from '../db/admin/async-store'
import { workerCaller } from '../clinic'
import { clinicDurableObjectName } from '../clinic/demo/do-name'
import { getHealth, listHealth, refreshTenantHealth } from '../ops/health-summary'
import type { OpsClinicSnapshot } from '../ops/metrics'
import { resolveAppBaseUrlFromEnv, resolveEmailTransport, type EmailTransport } from '../email'
import {
  d1CancelInvitation,
  d1CreateClinicWithOwnerInvitation,
  d1CreateInvitation,
  d1ListTeam,
  d1ResendInvitation,
} from '../team/d1-ops'
import {
  cancelOwnerInvite,
  createClinicWithOwnerInvite,
  inviteOwnerByEmail,
  resendOwnerInvite,
  type OwnerInviteServices,
} from './owner-invite'
import { startTenantPurgeWorkflow } from '../retention/workflow-start'
import {
  d1AssignOwner,
  d1CreateTenantWithOwner,
  d1GetOpenDeletionCommand,
  d1GetTenant,
  d1ListAudit,
  d1ListMembers,
  d1PendingDeletion,
  d1ReactivateTenant,
  d1RemoveOwner,
  d1SuspendTenant,
  d1UpdateTenant,
} from './d1-ops'
import {
  d1ListTenantOverview,
  d1ReadIntegrationStatus,
  listTenantOverview,
  readIntegrationStatus,
} from './overview'
import {
  serializeAdminTenantView,
  serializeMembership,
  serializeHealth,
  serializeHealthOverview,
  serializePlatformInvitation,
  serializeTenant,
} from './serialize'

type PlatformEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

const MAX_REASON_LENGTH = 300

/** Motivo opcional no corpo (a UI exige-o; a API mantém-se compatível). Lança se for longo demais. */
async function readReason(c: { req: { json: () => Promise<unknown> } }): Promise<string | undefined> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return undefined
  }
  const raw = (body as { reason?: unknown } | null)?.reason
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') throw new Error('reason_invalid')
  const reason = raw.trim()
  if (!reason) return undefined
  if (reason.length > MAX_REASON_LENGTH) throw new Error('reason_too_long')
  return reason
}

export type PlatformRouteOptions = {
  invalidatorFactory?: (env: WorkerBindings) => ClinicAccessInvalidator
  syncAdminDbFactory?: (env: WorkerBindings) => AdminDb | null
  /** Convite da primeira owner (DEC-194): relógio, e-mail e URL base, como na Equipe. */
  clockFactory?: () => Clock
  emailFactory?: (env: WorkerBindings) => EmailTransport
  appBaseUrlFactory?: (env: WorkerBindings) => string
  /** Leitura do snapshot do DO (saúde, #833); por omissão o Durable Object da clínica. */
  clinicStubFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => {
    getOpsSnapshot: (
      caller: ReturnType<typeof workerCaller>,
    ) => Promise<Partial<OpsClinicSnapshot> & { tenantId: string }>
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function adminErrorResponse(
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
    { error: err instanceof Error ? err.message : 'platform_error' },
    400,
  )
}

export function createPlatformRoutes(opts: PlatformRouteOptions = {}): Hono<PlatformEnv> {
  const routes = new Hono<PlatformEnv>()
  const clockNow = (): Clock => opts.clockFactory?.() ?? systemClock
  const emailFor = (env: WorkerBindings): EmailTransport =>
    opts.emailFactory?.(env) ?? resolveEmailTransport(env, { clock: clockNow() })
  const baseUrlFor = (env: WorkerBindings): string =>
    opts.appBaseUrlFactory?.(env) ?? resolveAppBaseUrlFromEnv(env)
  const inviteServices = (env: WorkerBindings, db: AdminDb): OwnerInviteServices => ({
    db,
    clock: clockNow(),
    email: emailFor(env),
    appBaseUrl: baseUrlFor(env),
  })

  routes.get('/api/platform/tenants', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.tenants.read')
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
      const rows = syncDb ? listTenantOverview(syncDb) : await d1ListTenantOverview(c.env.DB)
      c.header('Cache-Control', 'no-store')
      // Campos de `serializeTenant` + contagens e estado do WhatsApp (sem número, sem conteúdo).
      return c.json({
        tenants: rows.map((r) => ({
          ...serializeTenant({
            id: r.id,
            name: r.name,
            timezone: r.timezone,
            status: r.status,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            suspendedAt: r.suspendedAt,
            pendingDeletionAt: r.pendingDeletionAt,
          }),
          ownerCount: r.ownerCount,
          memberCount: r.memberCount,
          whatsapp: r.whatsapp,
        })),
      })
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

  routes.post('/api/platform/tenants', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.tenants.write')
      requirePlatformPermission(principal, 'platform.owners.manage')
      const body = await c.req.json<{
        name?: string
        timezone?: string
        id?: string
        ownerClerkUserId?: string
        ownerEmail?: string
      }>()
      const ownerEmail = body?.ownerEmail?.trim()
      const ownerClerkUserId = body?.ownerClerkUserId?.trim()
      if (ownerEmail && ownerClerkUserId) return c.json({ error: 'owner_ambiguous' }, 400)
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null

      // DEC-194: primeira owner por convite emitido pelo superadmin — a clínica nasce sem owner ativa.
      if (ownerEmail) {
        if (!body?.name?.trim()) return c.json({ error: 'name_and_owner_required' }, 400)
        if (!EMAIL_RE.test(ownerEmail)) return c.json({ error: 'owner_email_invalid' }, 400)
        const input = {
          id: body.id,
          name: body.name,
          timezone: body.timezone,
          ownerEmail,
          actorClerkUserId: principal.clerkUserId,
        }
        const now = clockNow().nowMs()
        if (syncDb) {
          const created = await createClinicWithOwnerInvite(inviteServices(c.env, syncDb), input)
          c.header('Cache-Control', 'no-store')
          return c.json(
            {
              tenant: serializeTenant(created.tenant),
              invitation: serializePlatformInvitation(created.invitation, now),
              emailSent: created.emailSent,
              deliveryJobId: created.deliveryJobId,
            },
            201,
          )
        }
        const created = await d1CreateClinicWithOwnerInvitation(c.env.DB, emailFor(c.env), {
          ...input,
          appBaseUrl: baseUrlFor(c.env),
          now,
        })
        c.header('Cache-Control', 'no-store')
        return c.json(
          {
            tenant: serializeTenant({
              id: created.tenant.id,
              name: created.tenant.name,
              timezone: created.tenant.timezone,
              status: 'active',
              createdAt: created.tenant.createdAt,
              updatedAt: created.tenant.createdAt,
              suspendedAt: null,
              pendingDeletionAt: null,
            }),
            invitation: serializePlatformInvitation(created.invitation, now),
            emailSent: created.emailSent,
            deliveryJobId: created.deliveryJobId,
          },
          201,
        )
      }

      if (!body?.name?.trim() || !ownerClerkUserId) {
        return c.json({ error: 'name_and_owner_required' }, 400)
      }
      const created = syncDb
        ? createTenantWithOwner(syncDb, systemClock, {
            id: body.id,
            name: body.name,
            timezone: body.timezone,
            ownerClerkUserId,
            actorClerkUserId: principal.clerkUserId,
          })
        : await d1CreateTenantWithOwner(c.env.DB, {
            id: body.id,
            name: body.name,
            timezone: body.timezone,
            ownerClerkUserId,
            actorClerkUserId: principal.clerkUserId,
          })
      c.header('Cache-Control', 'no-store')
      return c.json(
        {
          tenant: serializeTenant(created.tenant),
          owner: serializeMembership(created.owner),
        },
        201,
      )
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

  routes.get('/api/platform/tenants/:tenantId', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.tenants.read')
      const tenantId = c.req.param('tenantId')
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null

      if (syncDb) {
        const tenant = getTenant(syncDb, tenantId)
        if (!tenant) return c.json({ error: 'tenant_not_found' }, 404)
        const members = listMembersForTenant(syncDb, tenantId, { includeRevoked: true })
        const audit = listAuditForTenant(syncDb, tenantId, { limit: 30 })
        c.header('Cache-Control', 'no-store')
        return c.json(
          serializeAdminTenantView({
            tenant,
            members,
            integration: readIntegrationStatus(syncDb, tenantId),
            deletionCommand: getOpenDeletionCommand(syncDb, tenantId) ?? null,
            invitations: listPendingInvitationsForTenant(syncDb, tenantId),
            nowMs: clockNow().nowMs(),
            recentAudit: audit.map((e) => ({
              id: e.id,
              action: e.action,
              outcome: e.outcome,
              occurredAt: e.occurredAt,
              actorClerkUserId: e.actorClerkUserId,
              subjectClerkUserId: e.subjectClerkUserId,
            })),
          }),
        )
      }

      const tenant = await d1GetTenant(c.env.DB, tenantId)
      if (!tenant) return c.json({ error: 'tenant_not_found' }, 404)
      const members = await d1ListMembers(c.env.DB, tenantId)
      const audit = await d1ListAudit(c.env.DB, tenantId, 30)
      c.header('Cache-Control', 'no-store')
      return c.json(
        serializeAdminTenantView({
          tenant,
          members,
          integration: await d1ReadIntegrationStatus(c.env.DB, tenantId),
          deletionCommand: await d1GetOpenDeletionCommand(c.env.DB, tenantId),
          invitations: (await d1ListTeam(c.env.DB, tenantId, clockNow().nowMs())).invitations,
          nowMs: clockNow().nowMs(),
          recentAudit: audit,
        }),
      )
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

  routes.patch('/api/platform/tenants/:tenantId', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.tenants.write')
      const body = await c.req.json<{ name?: string; timezone?: string }>()
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
      const tenant = syncDb
        ? updateTenant(syncDb, systemClock, {
            tenantId: c.req.param('tenantId'),
            actorClerkUserId: principal.clerkUserId,
            name: body?.name,
            timezone: body?.timezone,
          })
        : await d1UpdateTenant(c.env.DB, {
            tenantId: c.req.param('tenantId'),
            actorClerkUserId: principal.clerkUserId,
            name: body?.name,
            timezone: body?.timezone,
          })
      c.header('Cache-Control', 'no-store')
      return c.json({ tenant: serializeTenant(tenant) })
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

  routes.post('/api/platform/tenants/:tenantId/suspend', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.tenants.write')
      const tenantId = c.req.param('tenantId')
      const reason = await readReason(c)
      const invalidator =
        opts.invalidatorFactory?.(c.env) ?? createDoInvalidator(c.env)
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null

      if (syncDb) {
        const result = await suspendTenantAndPropagate(syncDb, systemClock, invalidator, {
          tenantId,
          actorClerkUserId: principal.clerkUserId,
          source: 'tenant_suspend' satisfies FenceSource,
          reason,
        })
        c.header('Cache-Control', 'no-store')
        return c.json({
          tenant: serializeTenant(result.tenant),
          doNotified: result.doNotified,
          doError: result.doError ?? null,
          closedConnections: result.closedConnections,
          revokedSupportSessionIds: result.revokedSupportSessionIds,
          cancelledSupportRequestIds: result.cancelledSupportRequestIds,
        })
      }

      const lifecycle = await d1SuspendTenant(c.env.DB, tenantId, principal.clerkUserId, reason)
      const notified = await invalidator.applyTenantSuspended({
        tenantId,
        source: 'tenant_suspend',
      })
      c.header('Cache-Control', 'no-store')
      return c.json({
        tenant: serializeTenant(lifecycle.tenant),
        doNotified: notified.ok,
        doError: notified.ok ? null : notified.error,
        closedConnections: notified.ok ? notified.closedConnections : [],
        revokedSupportSessionIds: lifecycle.revokedSupportSessionIds,
        cancelledSupportRequestIds: lifecycle.cancelledSupportRequestIds,
      })
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

  routes.post('/api/platform/tenants/:tenantId/reactivate', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.tenants.write')
      const tenantId = c.req.param('tenantId')
      const reason = await readReason(c)
      const invalidator =
        opts.invalidatorFactory?.(c.env) ?? createDoInvalidator(c.env)
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null

      if (syncDb) {
        const result = await reactivateTenantAndPropagate(syncDb, systemClock, invalidator, {
          tenantId,
          actorClerkUserId: principal.clerkUserId,
          source: 'tenant_reactivate' satisfies FenceSource,
          reason,
        })
        c.header('Cache-Control', 'no-store')
        return c.json({
          tenant: serializeTenant(result.tenant),
          doNotified: result.doNotified,
          doError: result.doError ?? null,
          preservedRevokedMemberships: result.preservedRevokedMemberships,
          preservedRevokedSupport: result.preservedRevokedSupport,
        })
      }

      const lifecycle = await d1ReactivateTenant(c.env.DB, tenantId, principal.clerkUserId, reason)
      const clear = invalidator.applyTenantReactivated
      const notified = clear
        ? await clear({ tenantId, source: 'tenant_reactivate' })
        : { ok: false as const, error: 'reactivate_not_supported' }
      c.header('Cache-Control', 'no-store')
      return c.json({
        tenant: serializeTenant(lifecycle.tenant),
        doNotified: notified.ok,
        doError: notified.ok ? null : notified.error,
        preservedRevokedMemberships: lifecycle.preservedRevokedMemberships,
        preservedRevokedSupport: lifecycle.preservedRevokedSupport,
      })
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

  routes.delete('/api/platform/tenants/:tenantId', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.tenants.write')
      const tenantId = c.req.param('tenantId')
      const reason = await readReason(c)
      const invalidator =
        opts.invalidatorFactory?.(c.env) ?? createDoInvalidator(c.env)
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null

      if (syncDb) {
        const result = await markPendingDeletionAndPropagate(syncDb, systemClock, invalidator, {
          tenantId,
          actorClerkUserId: principal.clerkUserId,
          source: 'tenant_pending_deletion' satisfies FenceSource,
          reason,
        })
        // CI/unit: binding / env ausente → no-op; máquina sync continua a ser o driver.
        const workflow = await startTenantPurgeWorkflow(c.env?.TENANT_PURGE, {
          tenantId,
          commandId: result.deletionCommand.id,
          actorClerkUserId: principal.clerkUserId,
        })
        c.header('Cache-Control', 'no-store')
        return c.json({
          tenant: serializeTenant(result.tenant),
          deletionCommand: {
            id: result.deletionCommand.id,
            status: result.deletionCommand.status,
            requestedAt: result.deletionCommand.requestedAt,
          },
          doNotified: result.doNotified,
          doError: result.doError ?? null,
          closedConnections: result.closedConnections,
          workflow,
        })
      }

      const lifecycle = await d1PendingDeletion(c.env.DB, tenantId, principal.clerkUserId, reason)
      const notified = await invalidator.applyTenantSuspended({
        tenantId,
        source: 'tenant_pending_deletion',
      })
      const workflow = await startTenantPurgeWorkflow(c.env?.TENANT_PURGE, {
        tenantId,
        commandId: lifecycle.deletionCommand.id,
        actorClerkUserId: principal.clerkUserId,
      })
      c.header('Cache-Control', 'no-store')
      return c.json({
        tenant: serializeTenant(lifecycle.tenant),
        deletionCommand: {
          id: lifecycle.deletionCommand.id,
          status: lifecycle.deletionCommand.status,
          requestedAt: lifecycle.deletionCommand.requestedAt,
        },
        doNotified: notified.ok,
        doError: notified.ok ? null : notified.error,
        closedConnections: notified.ok ? notified.closedConnections : [],
        workflow,
      })
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

  const healthDb = (env: WorkerBindings) => {
    const syncDb = opts.syncAdminDbFactory?.(env) ?? null
    return syncDb ? asyncFromSync(syncDb) : fromD1(env.DB)
  }
  const stubFor = (env: WorkerBindings, tenantId: string) =>
    opts.clinicStubFactory?.(env, tenantId) ?? env.CLINIC.get(env.CLINIC.idFromName(clinicDurableObjectName(tenantId)))

  // DEC-193: lê o resumo gravado pelo cron; nunca consulta os Durable Objects a cada visita.
  routes.get('/api/platform/health', requireSuperadmin(), async (c) => {
    try {
      requirePlatformPermission(c.get('principal'), 'platform.tenants.read')
      c.header('Cache-Control', 'no-store')
      return c.json(serializeHealthOverview(await listHealth(healthDb(c.env))))
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

  routes.get('/api/platform/tenants/:tenantId/health', requireSuperadmin(), async (c) => {
    try {
      requirePlatformPermission(c.get('principal'), 'platform.tenants.read')
      const row = await getHealth(healthDb(c.env), c.req.param('tenantId'))
      if (!row) return c.json({ error: 'tenant_not_found' }, 404)
      c.header('Cache-Control', 'no-store')
      return c.json({ health: serializeHealth(row), refreshIntervalMs: serializeHealthOverview([]).refreshIntervalMs })
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

  /** «Atualizar» na aba Saúde: relê o DO desta clínica agora e grava o resumo. */
  routes.post('/api/platform/tenants/:tenantId/health/refresh', requireSuperadmin(), async (c) => {
    try {
      requirePlatformPermission(c.get('principal'), 'platform.tenants.read')
      const tenantId = c.req.param('tenantId')
      const db = healthDb(c.env)
      const before = await getHealth(db, tenantId)
      if (!before) return c.json({ error: 'tenant_not_found' }, 404)
      if (before.tenantStatus !== 'active') return c.json({ error: 'tenant_not_active' }, 403)
      const stub = stubFor(c.env, tenantId)
      await refreshTenantHealth(
        db,
        tenantId,
        (id) => stub.getOpsSnapshot(workerCaller(id)),
        clockNow().nowMs(),
      )
      c.header('Cache-Control', 'no-store')
      return c.json({
        health: serializeHealth((await getHealth(db, tenantId))!),
        refreshIntervalMs: serializeHealthOverview([]).refreshIntervalMs,
      })
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

  routes.get('/api/platform/tenants/:tenantId/members', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.tenants.read')
      const tenantId = c.req.param('tenantId')
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
      let members: MembershipRow[]
      if (syncDb) {
        if (!getTenant(syncDb, tenantId)) return c.json({ error: 'tenant_not_found' }, 404)
        members = listMembersForTenant(syncDb, tenantId, { includeRevoked: true })
      } else {
        if (!(await d1GetTenant(c.env.DB, tenantId))) {
          return c.json({ error: 'tenant_not_found' }, 404)
        }
        members = await d1ListMembers(c.env.DB, tenantId)
      }
      // Nome e e-mail vêm do Clerk, em lote. Falha do Clerk não derruba a lista: a UI mostra o id.
      let profiles = new Map<string, { displayName: string | null; email: string | null }>()
      try {
        const reader = c.get('authServices').staffProfiles
        if (reader) profiles = await reader.readStaffProfiles(members.map((m) => m.clerkUserId))
      } catch {
        profiles = new Map()
      }
      c.header('Cache-Control', 'no-store')
      return c.json({
        tenantId,
        members: members.map((m) => ({
          ...serializeMembership(m),
          displayName: profiles.get(m.clerkUserId)?.displayName ?? null,
          email: profiles.get(m.clerkUserId)?.email ?? null,
        })),
        clinicalAccess: false,
      })
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

  routes.post('/api/platform/tenants/:tenantId/invitations', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.owners.manage')
      const tenantId = c.req.param('tenantId')
      const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string })
      const email = body?.email?.trim()
      if (!email || !EMAIL_RE.test(email)) return c.json({ error: 'owner_email_invalid' }, 400)
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
      const now = clockNow().nowMs()
      const sent = syncDb
        ? await inviteOwnerByEmail(inviteServices(c.env, syncDb), {
            tenantId,
            email,
            actorClerkUserId: principal.clerkUserId,
          })
        : await d1CreateInvitation(c.env.DB, emailFor(c.env), {
            tenantId,
            email,
            issuedByClerkUserId: principal.clerkUserId,
            appBaseUrl: baseUrlFor(c.env),
            now,
            role: 'owner',
            asPlatformAdmin: true,
          })
      c.header('Cache-Control', 'no-store')
      return c.json(
        {
          invitation: serializePlatformInvitation(sent.invitation, now),
          emailSent: sent.emailSent,
          deliveryJobId: sent.deliveryJobId,
        },
        201,
      )
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

  routes.post(
    '/api/platform/tenants/:tenantId/invitations/:invitationId/resend',
    requireSuperadmin(),
    async (c) => {
      try {
        const principal = c.get('principal')
        requirePlatformPermission(principal, 'platform.owners.manage')
        const tenantId = c.req.param('tenantId')
        const invitationId = c.req.param('invitationId')
        const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
        const now = clockNow().nowMs()
        const sent = syncDb
          ? await resendOwnerInvite(inviteServices(c.env, syncDb), {
              tenantId,
              invitationId,
              actorClerkUserId: principal.clerkUserId,
            })
          : await d1ResendInvitation(c.env.DB, emailFor(c.env), {
              invitationId,
              tenantId,
              actorClerkUserId: principal.clerkUserId,
              appBaseUrl: baseUrlFor(c.env),
              now,
              asPlatformAdmin: true,
            })
        c.header('Cache-Control', 'no-store')
        return c.json({
          invitation: serializePlatformInvitation(sent.invitation, now),
          emailSent: sent.emailSent,
          deliveryJobId: sent.deliveryJobId,
        })
      } catch (err) {
        return adminErrorResponse(c, err)
      }
    },
  )

  routes.post(
    '/api/platform/tenants/:tenantId/invitations/:invitationId/cancel',
    requireSuperadmin(),
    async (c) => {
      try {
        const principal = c.get('principal')
        requirePlatformPermission(principal, 'platform.owners.manage')
        const tenantId = c.req.param('tenantId')
        const invitationId = c.req.param('invitationId')
        const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
        const now = clockNow().nowMs()
        const invitation = syncDb
          ? cancelOwnerInvite(inviteServices(c.env, syncDb), {
              tenantId,
              invitationId,
              actorClerkUserId: principal.clerkUserId,
            })
          : await d1CancelInvitation(c.env.DB, {
              invitationId,
              tenantId,
              actorClerkUserId: principal.clerkUserId,
              now,
              asPlatformAdmin: true,
            })
        c.header('Cache-Control', 'no-store')
        return c.json({ invitation: serializePlatformInvitation(invitation, now) })
      } catch (err) {
        return adminErrorResponse(c, err)
      }
    },
  )

  routes.post('/api/platform/tenants/:tenantId/owners', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.owners.manage')
      const body = await c.req.json<{ clerkUserId?: string }>()
      if (!body?.clerkUserId?.trim()) {
        return c.json({ error: 'clerk_user_id_required' }, 400)
      }
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
      const owner = syncDb
        ? assignOwner(syncDb, systemClock, {
            tenantId: c.req.param('tenantId'),
            clerkUserId: body.clerkUserId.trim(),
            actorClerkUserId: principal.clerkUserId,
          })
        : await d1AssignOwner(c.env.DB, {
            tenantId: c.req.param('tenantId'),
            clerkUserId: body.clerkUserId.trim(),
            actorClerkUserId: principal.clerkUserId,
          })
      c.header('Cache-Control', 'no-store')
      return c.json({ owner: serializeMembership(owner) }, 201)
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

  routes.post(
    '/api/platform/tenants/:tenantId/owners/replace',
    requireSuperadmin(),
    async (c) => {
      try {
        const principal = c.get('principal')
        requirePlatformPermission(principal, 'platform.owners.manage')
        const body = await c.req.json<{
          fromClerkUserId?: string
          toClerkUserId?: string
        }>()
        if (!body?.fromClerkUserId?.trim() || !body?.toClerkUserId?.trim()) {
          return c.json({ error: 'from_and_to_required' }, 400)
        }
        const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
        if (!syncDb) {
          // Replace atómico exige sync/transação; no D1 promove + remove em sequência.
          await d1AssignOwner(c.env.DB, {
            tenantId: c.req.param('tenantId'),
            clerkUserId: body.toClerkUserId.trim(),
            actorClerkUserId: principal.clerkUserId,
          })
          const from = await d1RemoveOwner(c.env.DB, {
            tenantId: c.req.param('tenantId'),
            clerkUserId: body.fromClerkUserId.trim(),
            actorClerkUserId: principal.clerkUserId,
          })
          const toMembers = await d1ListMembers(c.env.DB, c.req.param('tenantId'))
          const to = toMembers.find(
            (m) => m.clerkUserId === body.toClerkUserId!.trim() && m.status === 'active',
          )
          c.header('Cache-Control', 'no-store')
          return c.json({
            from: serializeMembership(from),
            to: to ? serializeMembership(to) : null,
          })
        }
        const result = replaceOwner(syncDb, systemClock, {
          tenantId: c.req.param('tenantId'),
          fromClerkUserId: body.fromClerkUserId.trim(),
          toClerkUserId: body.toClerkUserId.trim(),
          actorClerkUserId: principal.clerkUserId,
        })
        c.header('Cache-Control', 'no-store')
        return c.json({
          from: serializeMembership(result.from),
          to: serializeMembership(result.to),
        })
      } catch (err) {
        return adminErrorResponse(c, err)
      }
    },
  )

  routes.delete(
    '/api/platform/tenants/:tenantId/owners/:clerkUserId',
    requireSuperadmin(),
    async (c) => {
      try {
        const principal = c.get('principal')
        requirePlatformPermission(principal, 'platform.owners.manage')
        const tenantId = c.req.param('tenantId')
        const clerkUserId = c.req.param('clerkUserId')
        const invalidator =
          opts.invalidatorFactory?.(c.env) ?? createDoInvalidator(c.env)
        const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null

        const removed = syncDb
          ? removeOwner(syncDb, systemClock, {
              tenantId,
              clerkUserId,
              actorClerkUserId: principal.clerkUserId,
            })
          : await d1RemoveOwner(c.env.DB, {
              tenantId,
              clerkUserId,
              actorClerkUserId: principal.clerkUserId,
            })

        const notified = await invalidator.applyUserFence({
          tenantId,
          clerkUserId,
          reason: 'membership_revoked',
          source: 'superadmin',
        })

        c.header('Cache-Control', 'no-store')
        return c.json({
          owner: serializeMembership(removed),
          doNotified: notified.ok,
          doError: notified.ok ? null : notified.error,
          closedConnections: notified.ok ? notified.closedConnections : [],
        })
      } catch (err) {
        return adminErrorResponse(c, err)
      }
    },
  )

  routes.get(
    '/api/platform/tenants/:tenantId/clinical-probe',
    requireSuperadmin(),
    async (c) => {
      c.header('Cache-Control', 'no-store')
      return c.json(
        {
          error: 'clinical_access_denied',
          clinicalAccess: false,
          hint: 'Conteúdo clínico exige membership ou sessão de suporte aprovada',
        },
        403,
      )
    },
  )

  return routes
}
