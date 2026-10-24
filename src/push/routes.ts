/**
 * Rotas PWA / Web Push (#42).
 * Inscrição por utilizador×dispositivo×tenant; VAPID público; preferência nova conversa.
 */
import { Hono } from 'hono'
import type { Clock } from '../db/clock'
import { systemClock } from '../db/clock'
import { asyncFromSync, fromD1, type AsyncAdminDb } from '../db/admin/async-store'
import type { AdminDb } from '../db/admin/store'
import {
  authErrorResponse,
  requireAuth,
  requireTenantAccess,
  type AuthEnv,
} from '../auth/middleware'
import { isAuthError } from '../auth/errors'
import { requireClinicPermission } from '../auth/authorize'
import type { WorkerBindings } from '../worker/bindings'
import {
  deletePushSubscriptionByEndpointAsync,
  listPushSubscriptionsForUserAsync,
  updatePushPreferenceAsync,
  upsertPushSubscriptionAsync,
} from './subscriptions-async'
import { notifyNewConversationAsync } from './notify'
import { resolvePushMode, resolveVapidConfig } from './vapid'
import type { PushSubscriptionInput } from './types'

type PushEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type PushRouteOptions = {
  syncAdminDbFactory?: (env: WorkerBindings) => AdminDb | null
  clockFactory?: () => Clock
}

function pushError(
  c: { json: (body: unknown, status?: number) => Response },
  err: unknown,
): Response {
  if (isAuthError(err)) return authErrorResponse(c, err)
  const msg = err instanceof Error ? err.message : 'push_error'
  if (msg === 'invalid_push_endpoint' || msg === 'invalid_push_keys') {
    return c.json({ error: msg }, 400)
  }
  return c.json({ error: msg }, 400)
}

function resolveAsyncDb(env: WorkerBindings, opts: PushRouteOptions): AsyncAdminDb {
  const sync = opts.syncAdminDbFactory?.(env) ?? null
  if (sync) return asyncFromSync(sync)
  return fromD1(env.DB)
}

function serializeSub(row: {
  id: string
  endpoint: string
  notifyNewConversation: boolean
  createdAt: number
  updatedAt: number
  lastSeenAt: number
  userAgent: string | null
}) {
  return {
    id: row.id,
    endpoint: row.endpoint,
    notifyNewConversation: row.notifyNewConversation,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSeenAt: row.lastSeenAt,
    userAgent: row.userAgent,
  }
}

export function createPushRoutes(opts: PushRouteOptions = {}) {
  const routes = new Hono<PushEnv>()

  /** Chave pública VAPID — autenticada para evitar enumeração trivial. */
  routes.get('/api/push/vapid-public-key', requireAuth(), async (c) => {
    c.header('Cache-Control', 'no-store')
    try {
      const vapid = resolveVapidConfig(c.env)
      return c.json({
        publicKey: vapid.publicKey,
        mode: resolvePushMode(c.env),
        supported: true,
      })
    } catch {
      return c.json({
        publicKey: null,
        mode: 'unavailable',
        supported: false,
        error: 'vapid_unavailable',
      })
    }
  })

  routes.get(
    '/api/tenants/:tenantId/push/subscriptions',
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
      try {
        const db = resolveAsyncDb(c.env, opts)
        const rows = await listPushSubscriptionsForUserAsync(
          db,
          ctx.tenantId,
          principal.clerkUserId,
        )
        c.header('Cache-Control', 'no-store')
        return c.json({
          subscriptions: rows.map(serializeSub),
          pushMode: resolvePushMode(c.env),
        })
      } catch (err) {
        return pushError(c, err)
      }
    },
  )

  routes.post(
    '/api/tenants/:tenantId/push/subscriptions',
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

      const body = await c.req.json<{
        subscription?: PushSubscriptionInput
        notifyNewConversation?: boolean
      }>()
      if (!body.subscription?.endpoint || !body.subscription.keys) {
        return c.json({ error: 'subscription_required' }, 400)
      }

      const clock = opts.clockFactory?.() ?? systemClock
      try {
        const db = resolveAsyncDb(c.env, opts)
        const row = await upsertPushSubscriptionAsync(db, clock, {
          tenantId: ctx.tenantId,
          clerkUserId: principal.clerkUserId,
          subscription: body.subscription,
          userAgent: c.req.header('user-agent') ?? null,
          notifyNewConversation: body.notifyNewConversation,
        })
        c.header('Cache-Control', 'no-store')
        return c.json({ subscription: serializeSub(row) }, 201)
      } catch (err) {
        return pushError(c, err)
      }
    },
  )

  routes.patch(
    '/api/tenants/:tenantId/push/preferences',
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
      const body = await c.req.json<{
        notifyNewConversation?: boolean
        endpoint?: string
      }>()
      if (typeof body.notifyNewConversation !== 'boolean') {
        return c.json({ error: 'notify_new_conversation_required' }, 400)
      }
      const clock = opts.clockFactory?.() ?? systemClock
      try {
        const db = resolveAsyncDb(c.env, opts)
        const updated = await updatePushPreferenceAsync(db, clock, {
          tenantId: ctx.tenantId,
          clerkUserId: principal.clerkUserId,
          endpoint: body.endpoint,
          notifyNewConversation: body.notifyNewConversation,
        })
        c.header('Cache-Control', 'no-store')
        return c.json({ updated })
      } catch (err) {
        return pushError(c, err)
      }
    },
  )

  routes.delete(
    '/api/tenants/:tenantId/push/subscriptions',
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
      const body = await c.req
        .json<{ endpoint?: string }>()
        .catch(() => ({}) as { endpoint?: string })
      const endpoint =
        body.endpoint ??
        new URL(c.req.url).searchParams.get('endpoint') ??
        undefined
      if (!endpoint) return c.json({ error: 'endpoint_required' }, 400)
      try {
        const db = resolveAsyncDb(c.env, opts)
        const removed = await deletePushSubscriptionByEndpointAsync(db, {
          tenantId: ctx.tenantId,
          clerkUserId: principal.clerkUserId,
          endpoint,
        })
        c.header('Cache-Control', 'no-store')
        return c.json({ removed })
      } catch (err) {
        return pushError(c, err)
      }
    },
  )

  /**
   * Harness: dispara push de nova conversa (só tenants sintéticos).
   * Produto real dispara no consumer após conversation.created.
   */
  routes.post('/api/f5/push/notify-new-conversation', async (c) => {
    if (resolvePushMode(c.env) === 'live' && c.env.ENVIRONMENT === 'production') {
      return c.json({ error: 'harness_disabled' }, 404)
    }
    const body = await c.req.json<{
      tenantId?: string
      conversationId?: string
      tenantName?: string
    }>()
    if (!body.tenantId?.startsWith('clinic-demo-') || !body.conversationId) {
      return c.json({ error: 'synthetic_tenants_only' }, 400)
    }
    const clock = opts.clockFactory?.() ?? systemClock
    try {
      const db = resolveAsyncDb(c.env, opts)
      const result = await notifyNewConversationAsync(
        {
          db,
          clock,
          vapid: resolveVapidConfig(c.env),
        },
        {
          tenantId: body.tenantId,
          conversationId: body.conversationId,
          tenantName: body.tenantName,
        },
      )
      c.header('Cache-Control', 'no-store')
      return c.json({
        ...result,
        records: result.records.map((r) => ({
          tenantId: r.tenantId,
          clerkUserId: r.clerkUserId,
          conversationId: r.conversationId,
          status: r.status,
          payloadBody: r.payload.body,
          payloadUrl: r.payload.url,
        })),
      })
    } catch (err) {
      return pushError(c, err)
    }
  })

  return routes
}
