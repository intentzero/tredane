/**
 * Rotas WhatsApp Embedded Signup e gestão de conexão (#31).
 * Escritas: owner (clinic.config.write). Leitura: owner + attendant.
 */
import { metaSealKeys } from '../security/sealed-secret'
import { Hono } from 'hono'
import { requireClinicPermission } from '../auth/authorize'
import {
  authErrorResponse,
  requireAuth,
  requireTenantAccess,
  type AuthEnv,
} from '../auth/middleware'
import { isAuthError } from '../auth/errors'
import {
  clinicInbox,
  clinicWhatsapp,
  workerCaller,
  type ClinicDb,
} from '../clinic'
import { systemClock, type Clock } from '../db/clock'
import type { AdminDb } from '../db/admin/store'
import type { WorkerBindings } from '../worker/bindings'
import {
  createWhatsappService,
  WhatsappServiceError,
  type WhatsappService,
} from './service'
import { createD1WhatsappOps, type D1WhatsappOps } from './d1-ops'
import {
  createD1DevSyncStore,
  isWhatsappDevSyncEnabled,
  syncExistingBinding,
  type DevSyncStore,
} from './dev-sync'
import type { ClinicChannelSync } from './service'
import { createMetaAdapter, resolveMetaMode } from './meta'
import {
  assertNoSecretsInPayload,
  serializeConnection,
  serializeSignupSession,
} from './serialize'
import type {
  CompleteSignupInput,
  WhatsappConnectionView,
  WhatsappSignupPurpose,
  WhatsappSignupSessionView,
} from './types'

type WaEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type WhatsappRouteOptions = {
  syncAdminDbFactory?: (env: WorkerBindings) => AdminDb | null
  clockFactory?: () => Clock
  serviceFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => WhatsappService | Promise<WhatsappService>
  /** Testes: listar modelos a partir do SQLite em memória da clínica. */
  clinicDbFactory?: (tenantId: string) => { db: ClinicDb; clock: Clock } | null
  /** Testes: store/sync da rota staging-only dev/sync-existing-binding. */
  devSyncStoreFactory?: (env: WorkerBindings) => DevSyncStore
  devSyncChannelSyncFactory?: (env: WorkerBindings) => ClinicChannelSync
}

/** Contrato mínimo usado pelas rotas (sync service ou D1 ops). */
type WhatsappOps = {
  getConnection(tenantId: string): WhatsappConnectionView | Promise<WhatsappConnectionView>
  startSignupSession(input: {
    tenantId: string
    actorClerkUserId: string
    purpose: WhatsappSignupPurpose
  }): WhatsappSignupSessionView | Promise<WhatsappSignupSessionView>
  completeSignup(input: {
    tenantId: string
    actorClerkUserId: string
    payload: CompleteSignupInput
  }): Promise<WhatsappConnectionView>
  disconnect(input: {
    tenantId: string
    actorClerkUserId: string
    clinicNameConfirmation: string
    expectedClinicName: string
  }): Promise<WhatsappConnectionView>
  markInterrupted(input: {
    tenantId: string
    reason: string
    actorClerkUserId?: string | null
  }): Promise<WhatsappConnectionView>
}

function waError(
  c: { json: (body: unknown, status?: number) => Response },
  err: unknown,
): Response {
  if (isAuthError(err)) return authErrorResponse(c, err)
  if (err instanceof WhatsappServiceError) {
    const status = err.status as 400 | 403 | 409 | 503
    return c.json({ error: err.code, message: err.message }, status)
  }
  return c.json(
    { error: err instanceof Error ? err.message : 'whatsapp_error' },
    400,
  )
}

type ChannelSyncInput = {
  status: 'disconnected' | 'connected' | 'interrupted'
  bindingId?: string | null
  phoneNumberId?: string | null
  wabaId?: string | null
  displayPhone?: string | null
  displayName?: string | null
  connectedBy?: string | null
  connectedAt?: number | null
  interruptedAt?: number | null
  interruptReason?: string | null
  actor?: string | null
  action: string
}

function createDoChannelSync(env: WorkerBindings) {
  return {
    async syncChannel(tenantId: string, input: ChannelSyncInput) {
      const stub = env.CLINIC.get(env.CLINIC.idFromName(tenantId))
      await stub.syncWhatsappChannel(workerCaller(tenantId, 'whatsapp'), input)
    },
  }
}

async function resolveOps(
  env: WorkerBindings,
  tenantId: string,
  opts: WhatsappRouteOptions,
): Promise<WhatsappOps> {
  if (opts.serviceFactory) {
    return opts.serviceFactory(env, tenantId)
  }

  const syncDb = opts.syncAdminDbFactory?.(env) ?? null
  const clock = opts.clockFactory?.() ?? systemClock
  const metaEnv = {
    META_MODE: env.META_MODE,
    META_APP_ID: env.META_APP_ID,
    META_APP_SECRET: env.META_APP_SECRET,
    META_CONFIG_ID: env.META_CONFIG_ID,
    META_GRAPH_API_VERSION: env.META_GRAPH_API_VERSION,
    ENVIRONMENT: env.ENVIRONMENT,
  }
  const channelSync = env.CLINIC ? createDoChannelSync(env) : undefined

  if (syncDb) {
    return createWhatsappService({
      db: syncDb,
      clock,
      metaEnv,
      sealKeys: metaSealKeys(env),
      channelSync,
    })
  }

  // Produção: D1 assíncrono
  const meta = createMetaAdapter(metaEnv)
  return createD1WhatsappOps({
    db: env.DB,
    meta,
    metaMode: resolveMetaMode(metaEnv),
    metaEnv: {
      ...metaEnv,
      META_TOKEN_SECRET: env.META_TOKEN_SECRET,
      TOKEN_ENCRYPTION_KEY: env.TOKEN_ENCRYPTION_KEY,
    },
    channelSync,
    nowMs: () => clock.nowMs(),
  }) satisfies D1WhatsappOps
}

export function createWhatsappRoutes(opts: WhatsappRouteOptions = {}) {
  const app = new Hono<WaEnv>()
  const tenant = [
    requireAuth(),
    requireTenantAccess({ param: 'tenantId' }),
  ] as const

  app.get('/api/tenants/:tenantId/whatsapp', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.context.read')
      const ops = await resolveOps(c.env, ctx.tenantId, opts)
      const view = await ops.getConnection(ctx.tenantId)
      const body = serializeConnection(view)
      assertNoSecretsInPayload(body)
      return c.json(body)
    } catch (err) {
      return waError(c, err)
    }
  })

  app.post('/api/tenants/:tenantId/whatsapp/session', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      const principal = c.get('principal')!
      if (principal.kind !== 'human') {
        return c.json({ error: 'permission_denied' }, 403)
      }
      const body = (await c.req.json().catch(() => ({}))) as {
        purpose?: WhatsappSignupPurpose
      }
      const purpose = body.purpose ?? 'connect'
      if (!['connect', 'reconnect', 'replace'].includes(purpose)) {
        return c.json({ error: 'invalid_purpose', message: 'purpose inválido' }, 400)
      }
      const ops = await resolveOps(c.env, ctx.tenantId, opts)
      const session = await ops.startSignupSession({
        tenantId: ctx.tenantId,
        actorClerkUserId: principal.clerkUserId,
        purpose,
      })
      const out = serializeSignupSession(session)
      assertNoSecretsInPayload(out)
      return c.json(out, 201)
    } catch (err) {
      return waError(c, err)
    }
  })

  app.post('/api/tenants/:tenantId/whatsapp/complete', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      const principal = c.get('principal')!
      if (principal.kind !== 'human') {
        return c.json({ error: 'permission_denied' }, 403)
      }
      const payload = (await c.req.json()) as {
        state?: string
        code?: string
        phoneNumberId?: string
        wabaId?: string
        displayPhone?: string | null
        displayName?: string | null
      }
      if (!payload.state || !payload.code || !payload.phoneNumberId || !payload.wabaId) {
        return c.json(
          {
            error: 'validation_error',
            message: 'state, code, phoneNumberId e wabaId são obrigatórios',
          },
          400,
        )
      }
      const ops = await resolveOps(c.env, ctx.tenantId, opts)
      const view = await ops.completeSignup({
        tenantId: ctx.tenantId,
        actorClerkUserId: principal.clerkUserId,
        payload: {
          state: payload.state,
          code: payload.code,
          phoneNumberId: payload.phoneNumberId,
          wabaId: payload.wabaId,
          displayPhone: payload.displayPhone,
          displayName: payload.displayName,
        },
      })
      const out = serializeConnection(view)
      assertNoSecretsInPayload(out)
      return c.json(out)
    } catch (err) {
      return waError(c, err)
    }
  })

  app.post('/api/tenants/:tenantId/whatsapp/disconnect', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      const principal = c.get('principal')!
      if (principal.kind !== 'human') {
        return c.json({ error: 'permission_denied' }, 403)
      }
      const body = (await c.req.json()) as { clinicNameConfirmation?: string }
      if (!body.clinicNameConfirmation) {
        return c.json(
          {
            error: 'validation_error',
            message: 'clinicNameConfirmation obrigatório',
          },
          400,
        )
      }
      const ops = await resolveOps(c.env, ctx.tenantId, opts)
      const view = await ops.disconnect({
        tenantId: ctx.tenantId,
        actorClerkUserId: principal.clerkUserId,
        clinicNameConfirmation: body.clinicNameConfirmation,
        expectedClinicName: ctx.tenantName,
      })
      const out = serializeConnection(view)
      assertNoSecretsInPayload(out)
      return c.json(out)
    } catch (err) {
      return waError(c, err)
    }
  })

  /**
   * Modelos sincronizados (#33 / DEC-040). Categoria/custo da fonte vigente —
   * sem preços inventados. Aprovação Meta real = GATE-10.
   */
  app.get('/api/tenants/:tenantId/whatsapp/templates', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.inbox.reply')
      const tenantId = c.req.param('tenantId')
      const approvedOnly = c.req.query('approvedOnly') !== '0'
      let templates: ReturnType<typeof clinicInbox.listWhatsappTemplates> = []
      const mem = opts.clinicDbFactory?.(tenantId)
      if (mem) {
        if (clinicInbox.listWhatsappTemplates(mem.db, tenantId).length === 0) {
          clinicInbox.seedSyntheticWhatsappTemplates(mem.db, tenantId, mem.clock)
        }
        templates = clinicInbox.listWhatsappTemplates(mem.db, tenantId, {
          approvedOnly,
        })
      } else if (c.env.CLINIC) {
        const stub = c.env.CLINIC.get(c.env.CLINIC.idFromName(tenantId))
        templates = await stub.listWhatsappTemplates(
          workerCaller(tenantId, c.get('principal').clerkUserId),
          { approvedOnly },
        )
      }
      const body = {
        items: templates.map((t) => ({
          name: t.name,
          language: t.language,
          status: t.status,
          category: t.category,
          bodyPreview: t.bodyPreview,
          paramKeys: t.paramKeys,
          pricingCategory: t.pricingCategory,
          pricingNote: t.pricingNote,
          syncedAt: t.syncedAt,
        })),
        source: 'clinic_catalog',
        note: 'Preços: consultar tabela vigente Meta — Tredane não fixa valores.',
      }
      assertNoSecretsInPayload(body)
      return c.json(body)
    } catch (err) {
      return waError(c, err)
    }
  })

  /**
   * STAGING-ONLY (Paulo, 2026-10-27): sincroniza o DO da clínica com o vínculo
   * activo já existente em D1 (criado sem Embedded Signup). Gate antes da auth:
   * fora de ENVIRONMENT=staging + WHATSAPP_DEV_SYNC_ENABLED=true responde 404.
   * Não usa o adaptador Meta (META_CONFIG_ID ausente em staging).
   */
  app.post(
    '/api/tenants/:tenantId/whatsapp/dev/sync-existing-binding',
    async (c, next) => {
      if (!isWhatsappDevSyncEnabled(c.env)) {
        return c.json({ error: 'not_found' }, 404)
      }
      await next()
    },
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const principal = c.get('principal')!
        if (principal.kind !== 'human') {
          return c.json({ error: 'permission_denied' }, 403)
        }
        const store =
          opts.devSyncStoreFactory?.(c.env) ?? createD1DevSyncStore(c.env.DB)
        const channelSync =
          opts.devSyncChannelSyncFactory?.(c.env)
          ?? (c.env.CLINIC ? createDoChannelSync(c.env) : undefined)
        if (!channelSync) {
          return c.json({ error: 'clinic_do_unavailable' }, 503)
        }
        const clock = opts.clockFactory?.() ?? systemClock
        const result = await syncExistingBinding({
          store,
          sealKeys: metaSealKeys(c.env),
          channelSync,
          tenantId: ctx.tenantId,
          actorClerkUserId: principal.clerkUserId,
          nowMs: clock.nowMs(),
        })
        assertNoSecretsInPayload(result)
        if (!result.ok) {
          return c.json(result, result.error === 'token_key_mismatch' ? 409 : 404)
        }
        return c.json(result)
      } catch (err) {
        return waError(c, err)
      }
    },
  )

  /**
   * Simula revogação Meta (M-24) — só META_MODE=synthetic.
   * Produção: detecção via webhooks (#32).
   */
  app.post(
    '/api/tenants/:tenantId/whatsapp/dev/interrupt',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const principal = c.get('principal')!
        if (principal.kind !== 'human') {
          return c.json({ error: 'permission_denied' }, 403)
        }
        const body = (await c.req.json().catch(() => ({}))) as {
          reason?: string
        }
        const ops = await resolveOps(c.env, ctx.tenantId, opts)
        const view = await ops.markInterrupted({
          tenantId: ctx.tenantId,
          reason: body.reason ?? 'Autorização removida ou expirada (simulado)',
          actorClerkUserId: principal.clerkUserId,
        })
        const out = serializeConnection(view)
        assertNoSecretsInPayload(out)
        return c.json(out)
      } catch (err) {
        return waError(c, err)
      }
    },
  )

  return app
}

/** Gateway em memória para testes HTTP (sem DO). */
export function createMemoryWhatsappChannelSync(
  getDb: (tenantId: string) => { db: ClinicDb; clock: Clock },
) {
  return {
    async syncChannel(tenantId: string, input: ChannelSyncInput) {
      const { db, clock } = getDb(tenantId)
      clinicWhatsapp.syncWhatsappChannel(db, tenantId, input, clock)
      if (input.status === 'connected') {
        clinicInbox.seedSyntheticWhatsappTemplates(db, tenantId, clock)
      }
    },
  }
}
