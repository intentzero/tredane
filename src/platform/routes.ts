/**
 * Rotas Platform Admin (#24 / DEC-018/020 / REQ-004/006).
 * Sem UI de biblioteca de componentes (#22); API + testes sintéticos.
 * Superadmin verificado no backend; sem acesso clínico implícito.
 */
import { Hono } from 'hono'
import { systemClock } from '../db/clock'
import {
  assignOwner,
  createTenantWithOwner,
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
import { startTenantPurgeWorkflow } from '../retention/workflow-start'
import {
  d1AssignOwner,
  d1CreateTenantWithOwner,
  d1GetOpenDeletionCommand,
  d1GetTenant,
  d1ListAudit,
  d1ListMembers,
  d1ListTenants,
  d1PendingDeletion,
  d1ReactivateTenant,
  d1RemoveOwner,
  d1SuspendTenant,
  d1UpdateTenant,
} from './d1-ops'
import { stubIntegrationStatus } from './integration-status'
import {
  serializeAdminTenantView,
  serializeMembership,
  serializeTenant,
} from './serialize'

type PlatformEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type PlatformRouteOptions = {
  invalidatorFactory?: (env: WorkerBindings) => ClinicAccessInvalidator
  syncAdminDbFactory?: (env: WorkerBindings) => AdminDb | null
}

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

  routes.get('/api/platform/tenants', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.tenants.read')
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
      const tenants = syncDb
        ? syncDb
            .all<{
              id: string
              name: string
              timezone: string
              status: string
              created_at: number
              updated_at: number
              suspended_at: number | null
              pending_deletion_at: number | null
            }>(
              `SELECT id, name, timezone, status, created_at, updated_at, suspended_at, pending_deletion_at
               FROM tenants ORDER BY id`,
            )
            .map((t) =>
              serializeTenant({
                id: t.id,
                name: t.name,
                timezone: t.timezone,
                status: t.status as 'active' | 'suspended' | 'pending_deletion',
                createdAt: t.created_at,
                updatedAt: t.updated_at,
                suspendedAt: t.suspended_at,
                pendingDeletionAt: t.pending_deletion_at,
              }),
            )
        : (await d1ListTenants(c.env.DB)).map(serializeTenant)
      c.header('Cache-Control', 'no-store')
      return c.json({ tenants })
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
      }>()
      if (!body?.name?.trim() || !body?.ownerClerkUserId?.trim()) {
        return c.json({ error: 'name_and_owner_required' }, 400)
      }
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
      const created = syncDb
        ? createTenantWithOwner(syncDb, systemClock, {
            id: body.id,
            name: body.name,
            timezone: body.timezone,
            ownerClerkUserId: body.ownerClerkUserId,
            actorClerkUserId: principal.clerkUserId,
          })
        : await d1CreateTenantWithOwner(c.env.DB, {
            id: body.id,
            name: body.name,
            timezone: body.timezone,
            ownerClerkUserId: body.ownerClerkUserId,
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
            integration: stubIntegrationStatus(),
            deletionCommand: getOpenDeletionCommand(syncDb, tenantId) ?? null,
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
          integration: stubIntegrationStatus(),
          deletionCommand: await d1GetOpenDeletionCommand(c.env.DB, tenantId),
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
      const invalidator =
        opts.invalidatorFactory?.(c.env) ?? createDoInvalidator(c.env)
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null

      if (syncDb) {
        const result = await suspendTenantAndPropagate(syncDb, systemClock, invalidator, {
          tenantId,
          actorClerkUserId: principal.clerkUserId,
          source: 'tenant_suspend' satisfies FenceSource,
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

      const lifecycle = await d1SuspendTenant(c.env.DB, tenantId, principal.clerkUserId)
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
      const invalidator =
        opts.invalidatorFactory?.(c.env) ?? createDoInvalidator(c.env)
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null

      if (syncDb) {
        const result = await reactivateTenantAndPropagate(syncDb, systemClock, invalidator, {
          tenantId,
          actorClerkUserId: principal.clerkUserId,
          source: 'tenant_reactivate' satisfies FenceSource,
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

      const lifecycle = await d1ReactivateTenant(c.env.DB, tenantId, principal.clerkUserId)
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
      const invalidator =
        opts.invalidatorFactory?.(c.env) ?? createDoInvalidator(c.env)
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null

      if (syncDb) {
        const result = await markPendingDeletionAndPropagate(syncDb, systemClock, invalidator, {
          tenantId,
          actorClerkUserId: principal.clerkUserId,
          source: 'tenant_pending_deletion' satisfies FenceSource,
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

      const lifecycle = await d1PendingDeletion(c.env.DB, tenantId, principal.clerkUserId)
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

  routes.get('/api/platform/tenants/:tenantId/members', requireSuperadmin(), async (c) => {
    try {
      const principal = c.get('principal')
      requirePlatformPermission(principal, 'platform.tenants.read')
      const tenantId = c.req.param('tenantId')
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null
      if (syncDb) {
        if (!getTenant(syncDb, tenantId)) return c.json({ error: 'tenant_not_found' }, 404)
        const members = listMembersForTenant(syncDb, tenantId, { includeRevoked: true })
        c.header('Cache-Control', 'no-store')
        return c.json({
          tenantId,
          members: members.map(serializeMembership),
          clinicalAccess: false,
        })
      }
      if (!(await d1GetTenant(c.env.DB, tenantId))) {
        return c.json({ error: 'tenant_not_found' }, 404)
      }
      const members = await d1ListMembers(c.env.DB, tenantId)
      c.header('Cache-Control', 'no-store')
      return c.json({
        tenantId,
        members: members.map(serializeMembership),
        clinicalAccess: false,
      })
    } catch (err) {
      return adminErrorResponse(c, err)
    }
  })

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
