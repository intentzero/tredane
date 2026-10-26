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
import { startTenantPurgeWorkflow } from './workflow-start'
import { tickTenantPurgeOnEnv } from './env-orchestrator'

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
        const clock = opts.clockFactory?.() ?? systemClock
        const body = (await c.req.json().catch(() => ({}))) as {
          runUntilDone?: boolean
          /** Preferir Workflow durável quando o binding existir (produção). */
          useWorkflow?: boolean
        }

        // Caminho sync (CI/unit com node:sqlite) — não muda comportamento #43.
        if (syncDb) {
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
            driver: 'sync_state_machine',
          })
        }

        // Produção / runtime: Workflow ou tick D1 pontual.
        const open = await c.env.DB.prepare(
          `SELECT id, tenant_id, status, requested_by_clerk_user_id, requested_at, updated_at,
                  payload_json, deadline_at, started_at, completed_at, last_step, last_error, alert_sent_at
           FROM tenant_deletion_commands
           WHERE tenant_id = ? AND status IN ('queued', 'in_progress')
           ORDER BY requested_at DESC LIMIT 1`,
        )
          .bind(tenantId)
          .first<{
            id: string
            tenant_id: string
            status: string
            requested_by_clerk_user_id: string
            requested_at: number
            updated_at: number
            payload_json: string | null
            deadline_at: number | null
            started_at: number | null
            completed_at: number | null
            last_step: string | null
            last_error: string | null
            alert_sent_at: number | null
          }>()

        if (!open) {
          return c.json({ error: 'deletion_command_not_found' }, 404)
        }

        const preferWorkflow = body.useWorkflow !== false && body.runUntilDone !== false
        if (preferWorkflow && c.env?.TENANT_PURGE) {
          const wf = await startTenantPurgeWorkflow(c.env.TENANT_PURGE, {
            tenantId,
            commandId: open.id,
            actorClerkUserId: principal.clerkUserId,
          })
          c.header('Cache-Control', 'no-store')
          return c.json({
            command: {
              id: open.id,
              tenantId: open.tenant_id,
              status: open.status,
              requestedAt: open.requested_at,
              updatedAt: open.updated_at,
              deadlineAt: open.deadline_at,
              startedAt: open.started_at,
              completedAt: open.completed_at,
              lastStep: open.last_step,
              lastError: open.last_error,
              alertSentAt: open.alert_sent_at,
            },
            stepped: null,
            done: open.status === 'completed',
            alerted: false,
            overdue: false,
            detail: { workflow: wf },
            driver: 'cloudflare_workflow',
          })
        }

        // Tick D1 pontual (sem Workflow ou useWorkflow=false).
        const tick = await tickTenantPurgeOnEnv(c.env, {
          tenantId,
          commandId: open.id,
          actorClerkUserId: principal.clerkUserId,
        })
        const after = await c.env.DB.prepare(
          `SELECT id, tenant_id, status, requested_by_clerk_user_id, requested_at, updated_at,
                  payload_json, deadline_at, started_at, completed_at, last_step, last_error, alert_sent_at
           FROM tenant_deletion_commands WHERE id = ?`,
        )
          .bind(open.id)
          .first<{
            id: string
            tenant_id: string
            status: string
            requested_by_clerk_user_id: string
            requested_at: number
            updated_at: number
            payload_json: string | null
            deadline_at: number | null
            started_at: number | null
            completed_at: number | null
            last_step: string | null
            last_error: string | null
            alert_sent_at: number | null
          }>()
        c.header('Cache-Control', 'no-store')
        return c.json({
          command: after
            ? {
                id: after.id,
                tenantId: after.tenant_id,
                status: after.status,
                requestedAt: after.requested_at,
                updatedAt: after.updated_at,
                deadlineAt: after.deadline_at,
                startedAt: after.started_at,
                completedAt: after.completed_at,
                lastStep: after.last_step,
                lastError: after.last_error,
                alertSentAt: after.alert_sent_at,
              }
            : null,
          stepped: tick.stepped,
          done: tick.done,
          alerted: tick.alerted,
          overdue: tick.overdue,
          detail: tick.detail,
          driver: 'd1_env_tick',
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
      const principal = c.get('principal')
      // Ator do audit vem sempre da sessão autenticada; nunca do corpo (spoof de audit).
      const actor = principal.clerkUserId

      // Harness / CI: sync state machine (sem secrets CF).
      if (syncDb) {
        const clock = opts.clockFactory?.() ?? systemClock
        const deps = buildPurgeDeps(opts, c.env, syncDb, clock, actor, tenantId)
        const result = await runTenantPurgeUntilDone(deps, { tenantId })
        return c.json({
          command: serializePurgeCommand(result.command),
          done: result.done,
          alerted: result.alerted,
          overdue: result.overdue,
          detail: result.detail,
          driver: 'sync_state_machine',
        })
      }

      // Runtime com D1: preferir Workflow; fallback ticks até done.
      const open = await c.env.DB.prepare(
        `SELECT id FROM tenant_deletion_commands
         WHERE tenant_id = ? AND status IN ('queued', 'in_progress')
         ORDER BY requested_at DESC LIMIT 1`,
      )
        .bind(tenantId)
        .first<{ id: string }>()
      if (!open) return c.json({ error: 'deletion_command_not_found' }, 404)

      if (c.env?.TENANT_PURGE) {
        const wf = await startTenantPurgeWorkflow(c.env.TENANT_PURGE, {
          tenantId,
          commandId: open.id,
          actorClerkUserId: actor,
        })
        return c.json({
          command: { id: open.id, tenantId, status: 'queued' },
          done: false,
          alerted: false,
          overdue: false,
          detail: { workflow: wf },
          driver: 'cloudflare_workflow',
        })
      }

      let last = await tickTenantPurgeOnEnv(c.env, {
        tenantId,
        commandId: open.id,
        actorClerkUserId: actor,
      })
      for (let i = 0; i < 20 && !last.done; i++) {
        last = await tickTenantPurgeOnEnv(c.env, {
          tenantId,
          commandId: open.id,
          actorClerkUserId: actor,
        })
        if (last.detail.error) break
      }
      return c.json({
        command: {
          id: open.id,
          tenantId,
          status: last.status,
          lastStep: last.lastStep,
        },
        done: last.done,
        alerted: last.alerted,
        overdue: last.overdue,
        detail: last.detail,
        driver: 'd1_env_tick',
      })
    } catch (err) {
      return retentionErrorResponse(c, err)
    }
  })

  return app
}
