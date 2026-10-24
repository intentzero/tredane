/**
 * Rotas de retenção / expurgo (#43 / REQ-071).
 */
import { Hono } from 'hono'
import { requireClinicPermission, requirePlatformPermission } from '../auth/authorize'
import {
  authErrorResponse,
  requireAuth,
  requireSuperadmin,
  requireTenantAccess,
  type AuthEnv,
} from '../auth/middleware'
import { isAuthError } from '../auth/errors'
import {
  ClinicError,
  ConflictError,
  NotFoundError,
  ValidationError,
  workerCaller,
} from '../clinic'
import { SYNTHETIC_TENANT_PREFIX } from '../clinic/constants'
import type { AdminDb } from '../db/admin/store'
import { getTenant } from '../db/admin/tenants'
import { systemClock, type Clock } from '../db/clock'
import type { WorkerBindings } from '../worker/bindings'
import {
  getOpenPurgeCommand,
  listPurgeCommandsForTenant,
  type PurgeCommandRow,
} from './commands'
import { isTenantPurged } from './guards'
import {
  runTenantPurgeUntilDone,
  tickTenantPurge,
  type ClinicWipeResult,
} from './orchestrator'
import { deleteAttachmentObjects } from './r2-purge'

type RetentionEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type RetentionClinicStub = {
  deleteContact: (
    caller: ReturnType<typeof workerCaller>,
    contactId: string,
  ) => Promise<{
    contactId: string
    deletedAttachmentIds: string[]
    deletedMessageCount: number
    anonymizedAppointmentCount: number
    auditId: string
  }>
  wipeClinicOperationalData: (
    caller: ReturnType<typeof workerCaller>,
  ) => Promise<ClinicWipeResult>
}

export type RetentionRouteOptions = {
  syncAdminDbFactory?: (env: WorkerBindings) => AdminDb | null
  clockFactory?: () => Clock
  clinicStubFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => RetentionClinicStub
  attachmentsBucketFactory?: (env: WorkerBindings) => R2Bucket | null
}

function retentionErrorResponse(
  c: { json: (body: unknown, status?: number) => Response },
  err: unknown,
): Response {
  if (isAuthError(err)) return authErrorResponse(c, err)
  if (err instanceof ValidationError) {
    return c.json(
      { error: err.code, message: err.message, details: err.details ?? null },
      400,
    )
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404)
  }
  if (err instanceof ConflictError) {
    return c.json({ error: err.code, message: err.message }, 409)
  }
  if (err instanceof ClinicError) {
    const status =
      err.code === 'tenant_mismatch' || err.code === 'unauthorized_caller'
        ? 403
        : 400
    return c.json({ error: err.code, message: err.message }, status)
  }
  if (err instanceof Error && err.message === 'deletion_command_not_found') {
    return c.json({ error: 'deletion_command_not_found', message: err.message }, 404)
  }
  return c.json(
    { error: err instanceof Error ? err.message : 'retention_error' },
    400,
  )
}

function serializePurgeCommand(cmd: PurgeCommandRow) {
  return {
    id: cmd.id,
    tenantId: cmd.tenantId,
    status: cmd.status,
    requestedAt: cmd.requestedAt,
    updatedAt: cmd.updatedAt,
    deadlineAt: cmd.deadlineAt,
    startedAt: cmd.startedAt,
    completedAt: cmd.completedAt,
    lastStep: cmd.lastStep,
    lastError: cmd.lastError,
    alertSentAt: cmd.alertSentAt,
  }
}

function createDoStub(env: WorkerBindings, tenantId: string): RetentionClinicStub {
  const stub = env.CLINIC.get(env.CLINIC.idFromName(tenantId))
  return {
    deleteContact: (caller, contactId) => stub.deleteContact(caller, contactId),
    wipeClinicOperationalData: (caller) => stub.wipeClinicOperationalData(caller),
  }
}

function buildPurgeDeps(
  opts: RetentionRouteOptions,
  env: WorkerBindings,
  syncDb: AdminDb,
  clock: Clock,
  actorClerkUserId: string,
  tenantId: string,
) {
  const stub = opts.clinicStubFactory?.(env, tenantId) ?? createDoStub(env, tenantId)
  return {
    adminDb: syncDb,
    clock,
    actorClerkUserId,
    attachmentsBucket:
      opts.attachmentsBucketFactory?.(env) ?? env.ATTACHMENTS ?? null,
    wipeClinic: async () =>
      stub.wipeClinicOperationalData(workerCaller(tenantId, actorClerkUserId)),
  }
}

export function createRetentionRoutes(opts: RetentionRouteOptions = {}) {
  const app = new Hono<RetentionEnv>()

  const tenant = [
    requireAuth(),
    requireTenantAccess({ param: 'tenantId' }),
  ] as const

  app.delete(
    '/api/tenants/:tenantId/contacts/:contactId',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.contacts.delete')
        const tenantId = c.req.param('tenantId')
        const contactId = c.req.param('contactId')
        const caller = workerCaller(tenantId, principal.clerkUserId)

        const stub =
          opts.clinicStubFactory?.(c.env, tenantId) ?? createDoStub(c.env, tenantId)
        const result = await stub.deleteContact(caller, contactId)

        const bucket =
          opts.attachmentsBucketFactory?.(c.env) ?? c.env.ATTACHMENTS ?? null
        let r2Deleted = 0
        if (bucket && result.deletedAttachmentIds.length > 0) {
          r2Deleted = await deleteAttachmentObjects(
            bucket,
            tenantId,
            result.deletedAttachmentIds,
          )
        }

        c.header('Cache-Control', 'no-store')
        return c.json({
          deleted: true,
          contactId: result.contactId,
          deletedMessageCount: result.deletedMessageCount,
          deletedAttachmentCount: result.deletedAttachmentIds.length,
          r2Deleted,
          anonymizedAppointmentCount: result.anonymizedAppointmentCount,
          auditId: result.auditId,
        })
      } catch (err) {
        return retentionErrorResponse(c, err)
      }
    },
  )

  app.get(
    '/api/platform/tenants/:tenantId/purge',
    requireAuth(),
    requireSuperadmin(),
    async (c) => {
      try {
        const principal = c.get('principal')
        requirePlatformPermission(principal, 'platform.tenants.read')
        const tenantId = c.req.param('tenantId')
        const syncDb = opts.syncAdminDbFactory?.(c.env)
        if (!syncDb) {
          return c.json({ error: 'admin_db_unavailable' }, 503)
        }
        const tenant = getTenant(syncDb, tenantId)
        if (!tenant && !isTenantPurged(syncDb, tenantId)) {
          return c.json({ error: 'tenant_not_found' }, 404)
        }
        const open = getOpenPurgeCommand(syncDb, tenantId)
        const history = listPurgeCommandsForTenant(syncDb, tenantId)
        c.header('Cache-Control', 'no-store')
        return c.json({
          tenant: tenant
            ? {
                id: tenant.id,
                status: tenant.status,
                pendingDeletionAt: tenant.pendingDeletionAt,
              }
            : { id: tenantId, status: 'purged', pendingDeletionAt: null },
          purged: isTenantPurged(syncDb, tenantId),
          openCommand: open ? serializePurgeCommand(open) : null,
          commands: history.map(serializePurgeCommand),
        })
      } catch (err) {
        return retentionErrorResponse(c, err)
      }
    },
  )

  app.post(
    '/api/platform/tenants/:tenantId/purge/tick',
    requireAuth(),
    requireSuperadmin(),
    async (c) => {
      try {
        const principal = c.get('principal')
        requirePlatformPermission(principal, 'platform.tenants.write')
        const tenantId = c.req.param('tenantId')
        const syncDb = opts.syncAdminDbFactory?.(c.env)
        if (!syncDb) {
          return c.json({ error: 'admin_db_unavailable' }, 503)
        }
        const clock = opts.clockFactory?.() ?? systemClock
        const body = (await c.req.json().catch(() => ({}))) as {
          runUntilDone?: boolean
        }
        const deps = buildPurgeDeps(
          opts,
          c.env,
          syncDb,
          clock,
          principal.clerkUserId,
          tenantId,
        )
        const result = body.runUntilDone
          ? await runTenantPurgeUntilDone(deps, { tenantId })
          : await tickTenantPurge(deps, { tenantId })

        c.header('Cache-Control', 'no-store')
        return c.json({
          command: serializePurgeCommand(result.command),
          stepped: result.stepped,
          done: result.done,
          alerted: result.alerted,
          overdue: result.overdue,
          detail: result.detail,
        })
      } catch (err) {
        return retentionErrorResponse(c, err)
      }
    },
  )

  app.post('/api/f6/retention/purge-run', requireAuth(), async (c) => {
    try {
      const body = (await c.req.json()) as {
        tenantId?: string
        actorClerkUserId?: string
      }
      const tenantId = body.tenantId
      if (!tenantId || !tenantId.startsWith(SYNTHETIC_TENANT_PREFIX)) {
        return c.json({ error: 'synthetic_tenant_required' }, 400)
      }
      const syncDb = opts.syncAdminDbFactory?.(c.env)
      if (!syncDb) return c.json({ error: 'admin_db_unavailable' }, 503)
      const clock = opts.clockFactory?.() ?? systemClock
      const principal = c.get('principal')
      const actor = body.actorClerkUserId ?? principal.clerkUserId
      const deps = buildPurgeDeps(opts, c.env, syncDb, clock, actor, tenantId)
      const result = await runTenantPurgeUntilDone(deps, { tenantId })
      return c.json({
        command: serializePurgeCommand(result.command),
        done: result.done,
        alerted: result.alerted,
        overdue: result.overdue,
        detail: result.detail,
      })
    } catch (err) {
      return retentionErrorResponse(c, err)
    }
  })

  return app
}
