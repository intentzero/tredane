/**
 * Rotas HTTP de tempo real e revogação (#23).
 * Sem telas produtivas do painel (#22).
 */
import { Hono } from 'hono'
import { systemClock } from '../db/clock'
import { requireClinicPermission } from '../auth/authorize'
import {
  authErrorResponse,
  requireAuth,
  requireTenantAccess,
  type AuthEnv,
} from '../auth/middleware'
import { isAuthError } from '../auth/errors'
import { ForbiddenError, NotFoundError, ConflictError } from '../db/admin/errors'
import { workerCaller } from '../clinic'
import {
  revokeMembershipAndPropagate,
  type ClinicAccessInvalidator,
} from './revoke'
import {
  WORKER_WS_ASSERTION,
  WS_INTERNAL_HEADERS,
  type FenceSource,
} from './protocol'
import type { WorkerBindings } from '../worker/bindings'
import type { AdminDb } from '../db/admin/store'
import { newId } from '../db/admin/ids'

type RealtimeBindings = WorkerBindings

type RealtimeEnv = {
  Bindings: RealtimeBindings
  Variables: AuthEnv['Variables']
}

function clinicStub(env: RealtimeBindings, tenantId: string) {
  return env.CLINIC.get(env.CLINIC.idFromName(tenantId))
}

export function createDoInvalidator(env: RealtimeBindings): ClinicAccessInvalidator {
  return {
    async applyUserFence(input) {
      try {
        const result = await clinicStub(env, input.tenantId).applyUserFence(input)
        return { ok: true, closedConnections: result.closedConnections }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'do_notify_failed',
        }
      }
    },
    async applyTenantSuspended(input) {
      try {
        const result = await clinicStub(env, input.tenantId).applyTenantSuspended(input)
        return { ok: true, closedConnections: result.closedConnections }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'do_notify_failed',
        }
      }
    },
  }
}

export type RealtimeRouteOptions = {
  invalidatorFactory?: (env: RealtimeBindings) => ClinicAccessInvalidator
  /** Preferido em testes unitários com node:sqlite. */
  syncAdminDbFactory?: (env: RealtimeBindings) => AdminDb | null
}

export function createRealtimeRoutes(opts: RealtimeRouteOptions = {}): Hono<RealtimeEnv> {
  const routes = new Hono<RealtimeEnv>()

  routes.get(
    '/api/tenants/:tenantId/ws',
    requireAuth(),
    requireTenantAccess({}),
    async (c) => {
      const ctx = c.get('tenantContext')
      const principal = c.get('principal')
      if (!ctx) return c.json({ error: 'tenant_access_denied' }, 403)
      try {
        requireClinicPermission(ctx, 'clinic.inbox.read')
      } catch (err) {
        return authErrorResponse(c, err)
      }
      if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
        return c.json({ error: 'websocket_upgrade_required' }, 426)
      }

      const headers = new Headers(c.req.raw.headers)
      headers.set(WS_INTERNAL_HEADERS.assertion, WORKER_WS_ASSERTION)
      headers.set(WS_INTERNAL_HEADERS.tenantId, ctx.tenantId)
      headers.set(WS_INTERNAL_HEADERS.clerkUserId, principal.clerkUserId)
      headers.set(WS_INTERNAL_HEADERS.sessionId, principal.sessionId)
      headers.set(WS_INTERNAL_HEADERS.role, ctx.role)

      return clinicStub(c.env, ctx.tenantId).fetch(
        new Request(c.req.raw.url, { method: 'GET', headers }),
      )
    },
  )

  routes.get(
    '/api/tenants/:tenantId/realtime/events',
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
      const after = Number(c.req.query('after') ?? '0')
      if (!Number.isFinite(after) || after < 0) {
        return c.json({ error: 'invalid_after' }, 400)
      }
      const result = (await clinicStub(c.env, ctx.tenantId).listEventsAfter(
        workerCaller(ctx.tenantId, c.get('principal').clerkUserId),
        after,
      )) as {
        eventSeq: number
        events: Array<{
          seq: number
          eventId: string
          type: string
          entityType: string
          entityId: string
          occurredAt: number
          payload: Record<string, unknown>
        }>
      }
      c.header('Cache-Control', 'no-store')
      return c.json({
        tenantId: ctx.tenantId,
        eventSeq: result.eventSeq,
        events: result.events.map((e) => ({
          seq: e.seq,
          eventId: e.eventId,
          type: e.type,
          entity: { type: e.entityType, id: e.entityId },
          occurredAt: e.occurredAt,
          payload: e.payload,
        })),
      })
    },
  )

  routes.get(
    '/api/tenants/:tenantId/realtime/snapshot',
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
      const caller = workerCaller(ctx.tenantId, c.get('principal').clerkUserId)
      const stub = clinicStub(c.env, ctx.tenantId)
      const [status, contacts] = await Promise.all([
        stub.getStatus(caller),
        stub.listSyntheticContacts(caller),
      ])
      c.header('Cache-Control', 'no-store')
      return c.json({
        tenantId: ctx.tenantId,
        eventSeq: status.eventSeq,
        contacts,
        connectionHint: { reconcileRequired: true },
      })
    },
  )

  routes.post(
    '/api/tenants/:tenantId/members/:clerkUserId/revoke',
    requireAuth(),
    requireTenantAccess({}),
    async (c) => {
      const ctx = c.get('tenantContext')
      const principal = c.get('principal')
      if (!ctx) return c.json({ error: 'tenant_access_denied' }, 403)
      try {
        requireClinicPermission(ctx, 'clinic.members.revoke_attendant')
      } catch (err) {
        return authErrorResponse(c, err)
      }

      const targetUserId = c.req.param('clerkUserId')
      if (!targetUserId) return c.json({ error: 'member_required' }, 400)
      if (targetUserId === principal.clerkUserId) {
        return c.json({ error: 'cannot_revoke_self' }, 400)
      }

      const invalidator =
        opts.invalidatorFactory?.(c.env) ?? createDoInvalidator(c.env)
      const syncDb = opts.syncAdminDbFactory?.(c.env) ?? null

      try {
        if (syncDb) {
          const result = await revokeMembershipAndPropagate(
            syncDb,
            systemClock,
            invalidator,
            {
              tenantId: ctx.tenantId,
              clerkUserId: targetUserId,
              actorClerkUserId: principal.clerkUserId,
              source: 'membership_revoke' satisfies FenceSource,
            },
          )
          c.header('Cache-Control', 'no-store')
          return c.json({
            tenantId: ctx.tenantId,
            clerkUserId: targetUserId,
            status: result.membership.status,
            doNotified: result.doNotified,
            doError: result.doError ?? null,
            closedConnections: result.closedConnections,
          })
        }

        return await revokeMembershipViaD1(
          c.env.DB,
          invalidator,
          {
            tenantId: ctx.tenantId,
            targetUserId,
            actorClerkUserId: principal.clerkUserId,
          },
          (body, status) => c.json(body, status),
        )
      } catch (err) {
        if (isAuthError(err)) return authErrorResponse(c, err)
        if (err instanceof ForbiddenError) {
          return c.json({ error: err.code }, 403)
        }
        if (err instanceof NotFoundError) {
          return c.json({ error: err.code }, 404)
        }
        if (err instanceof ConflictError) {
          return c.json({ error: err.code }, 400)
        }
        return c.json(
          { error: err instanceof Error ? err.message : 'revoke_failed' },
          400,
        )
      }
    },
  )

  return routes
}

async function revokeMembershipViaD1(
  db: D1Database,
  invalidator: ClinicAccessInvalidator,
  input: {
    tenantId: string
    targetUserId: string
    actorClerkUserId: string
  },
  json: (body: unknown, status?: 200 | 400 | 403 | 404) => Response,
): Promise<Response> {
  const now = Date.now()
  const actor = await db
    .prepare(
      `SELECT role, status FROM tenant_memberships
       WHERE tenant_id = ? AND clerk_user_id = ?`,
    )
    .bind(input.tenantId, input.actorClerkUserId)
    .first<{ role: string; status: string }>()

  if (!actor || actor.status !== 'active' || actor.role !== 'owner') {
    return json({ error: 'permission_denied' }, 403)
  }

  const target = await db
    .prepare(
      `SELECT role, status FROM tenant_memberships
       WHERE tenant_id = ? AND clerk_user_id = ?`,
    )
    .bind(input.tenantId, input.targetUserId)
    .first<{ role: string; status: string }>()

  if (!target) return json({ error: 'membership_not_found' }, 404)
  if (target.role === 'owner' && target.status === 'active') {
    return json({ error: 'cannot_revoke_owner' }, 403)
  }

  if (target.status === 'active') {
    const updated = await db
      .prepare(
        `UPDATE tenant_memberships
         SET status = 'revoked', revoked_at = ?
         WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active'`,
      )
      .bind(now, input.tenantId, input.targetUserId)
      .run()
    if (!updated.meta.changes || updated.meta.changes < 1) {
      return json({ error: 'membership_revoke_conflict' }, 400)
    }
    await db
      .prepare(
        `INSERT INTO central_audit_events (
          id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
          action, object_type, object_id, outcome, support_session_id, metadata_json
        ) VALUES (?, ?, ?, ?, ?, 'membership.revoke', 'tenant_membership', ?, 'success', NULL, ?)`,
      )
      .bind(
        newId('aud'),
        now,
        input.actorClerkUserId,
        input.targetUserId,
        input.tenantId,
        `${input.tenantId}:${input.targetUserId}`,
        JSON.stringify({ role: target.role }),
      )
      .run()
  }

  const notified = await invalidator.applyUserFence({
    tenantId: input.tenantId,
    clerkUserId: input.targetUserId,
    reason: 'membership_revoked',
    source: 'membership_revoke',
  })

  return json({
    tenantId: input.tenantId,
    clerkUserId: input.targetUserId,
    status: 'revoked',
    doNotified: notified.ok,
    doError: notified.ok ? null : notified.error,
    closedConnections: notified.ok ? notified.closedConnections : [],
  })
}
