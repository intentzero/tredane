/**
 * Rotas M-33 — conta Pix + prazo/política de sinal (#37 / REQ-076/077).
 * Escrita: só owner (clinic.config.write). Leitura: owner + attendant.
 * Credenciais nunca voltam na resposta.
 */
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
  ClinicError,
  NotFoundError,
  ValidationError,
  workerCaller,
} from '../clinic'
import type { WorkerBindings } from '../worker/bindings'
import type { PixAccountGateway } from './gateway'
import {
  serializePixAccount,
  serializePixCharge,
  serializePixSignalSettings,
} from './serialize'
import type { PixConnectDeps } from '../clinic/pix'
import type { PixEnvironment } from '../clinic/constants'

type PixEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type PixAccountRouteOptions = {
  gatewayFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => PixAccountGateway | Promise<PixAccountGateway>
  connectDepsFactory?: (env: WorkerBindings) => PixConnectDeps
}

function pixErrorResponse(
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
  if (err instanceof ClinicError) {
    const status =
      err.code === 'tenant_mismatch' || err.code === 'unauthorized_caller'
        ? 403
        : 400
    return c.json({ error: err.code, message: err.message }, status)
  }
  return c.json(
    { error: err instanceof Error ? err.message : 'pix_error' },
    400,
  )
}

function resolvePixMode(env: WorkerBindings): PixEnvironment {
  const raw = (env.PIX_MODE ?? '').trim().toLowerCase()
  if (raw === 'live') return 'live'
  if (raw === 'sandbox') return 'sandbox'
  return 'synthetic'
}

function defaultConnectDeps(env: WorkerBindings): PixConnectDeps {
  return {
    tokenSecret: env.PIX_TOKEN_SECRET,
    environment: resolvePixMode(env),
  }
}

function createDoGateway(env: WorkerBindings, tenantId: string): PixAccountGateway {
  const stub = env.CLINIC.get(env.CLINIC.idFromName(tenantId))
  return {
    getAccount: (caller) => stub.getPixAccount(caller),
    connect: (caller, input, deps) => stub.connectPixAccount(caller, input, deps),
    disconnect: (caller) => stub.disconnectPixAccount(caller),
    revoke: (caller, reason) => stub.revokePixCredential(caller, reason),
    getSignalSettings: (caller) => stub.getPixSignalSettings(caller),
    updateSignalSettings: (caller, input) =>
      stub.updatePixSignalSettings(caller, input),
    listCharges: (caller, accountId) => stub.listPixCharges(caller, accountId),
  }
}

async function resolveGateway(
  env: WorkerBindings,
  tenantId: string,
  opts: PixAccountRouteOptions,
): Promise<PixAccountGateway> {
  if (opts.gatewayFactory) return opts.gatewayFactory(env, tenantId)
  return createDoGateway(env, tenantId)
}

export function createPixAccountRoutes(opts: PixAccountRouteOptions = {}) {
  const app = new Hono<PixEnv>()
  const tenant = [
    requireAuth(),
    requireTenantAccess({ param: 'tenantId' }),
  ] as const

  app.get('/api/tenants/:tenantId/pix', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      const principal = c.get('principal')
      requireClinicPermission(ctx, 'clinic.context.read')
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const caller = workerCaller(ctx.tenantId, principal.clerkUserId)
      const account = await gw.getAccount(caller)
      const settings = await gw.getSignalSettings(caller)
      return c.json({
        account: serializePixAccount(account),
        signalSettings: serializePixSignalSettings(settings),
      })
    } catch (err) {
      return pixErrorResponse(c, err)
    }
  })

  app.post('/api/tenants/:tenantId/pix/connect', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      const principal = c.get('principal')
      requireClinicPermission(ctx, 'clinic.config.write')
      const body = (await c.req.json()) as {
        appId?: string
        environment?: PixEnvironment
      }
      if (!body.appId || typeof body.appId !== 'string') {
        throw new ValidationError('invalid_pix_app_id', 'appId é obrigatório')
      }
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const deps = (opts.connectDepsFactory ?? defaultConnectDeps)(c.env)
      const account = await gw.connect(
        workerCaller(ctx.tenantId, principal.clerkUserId),
        {
          appId: body.appId,
          clerkUserId: principal.clerkUserId,
          environment: body.environment ?? deps.environment,
        },
        deps,
      )
      return c.json({ account: serializePixAccount(account) })
    } catch (err) {
      return pixErrorResponse(c, err)
    }
  })

  app.post('/api/tenants/:tenantId/pix/disconnect', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      const principal = c.get('principal')
      requireClinicPermission(ctx, 'clinic.config.write')
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const result = await gw.disconnect(
        workerCaller(ctx.tenantId, principal.clerkUserId),
      )
      return c.json({
        account: serializePixAccount(result.account),
        chargesPreserved: result.chargesPreserved,
      })
    } catch (err) {
      return pixErrorResponse(c, err)
    }
  })

  app.patch('/api/tenants/:tenantId/pix/signal-settings', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      const principal = c.get('principal')
      requireClinicPermission(ctx, 'clinic.config.write')
      const body = (await c.req.json()) as {
        deadlineSeconds?: number
        cancellationPolicy?: string
      }
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const settings = await gw.updateSignalSettings(
        workerCaller(ctx.tenantId, principal.clerkUserId),
        {
          deadlineSeconds: body.deadlineSeconds,
          cancellationPolicy: body.cancellationPolicy,
        },
      )
      return c.json({ signalSettings: serializePixSignalSettings(settings) })
    } catch (err) {
      return pixErrorResponse(c, err)
    }
  })

  app.get('/api/tenants/:tenantId/pix/charges', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      const principal = c.get('principal')
      requireClinicPermission(ctx, 'clinic.context.read')
      const accountId = c.req.query('accountId') ?? undefined
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const charges = await gw.listCharges(
        workerCaller(ctx.tenantId, principal.clerkUserId),
        accountId,
      )
      return c.json({ items: charges.map(serializePixCharge) })
    } catch (err) {
      return pixErrorResponse(c, err)
    }
  })

  /**
   * Só PIX_MODE=synthetic — simula revogação de credencial (AC sandbox).
   */
  app.post('/api/tenants/:tenantId/pix/dev/revoke', ...tenant, async (c) => {
    try {
      if (resolvePixMode(c.env) === 'live') {
        return c.json({ error: 'not_available_in_live' }, 404)
      }
      const ctx = c.get('tenantContext')!
      const principal = c.get('principal')
      requireClinicPermission(ctx, 'clinic.config.write')
      const body = (await c.req.json().catch(() => ({}))) as { reason?: string }
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const account = await gw.revoke(
        workerCaller(ctx.tenantId, principal.clerkUserId),
        body.reason ?? 'revogação sintética de teste',
      )
      return c.json({ account: serializePixAccount(account) })
    } catch (err) {
      return pixErrorResponse(c, err)
    }
  })

  return app
}
