/**
 * Rotas M-33 conta Pix (#37) + cobrança na conversa (#38 / REQ-078/AC-46/51).
 * Conta/settings: owner escreve. Cobrança/agendar: clinic.agenda.operate.
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
  ConflictError,
  NotFoundError,
  ValidationError,
  workerCaller,
} from '../clinic'
import type { WorkerBindings } from '../worker/bindings'
import type { PixAccountGateway, PixChargeCreateDeps } from './gateway'
import {
  serializePixAccount,
  serializePixCharge,
  serializePixChargeDetail,
  serializePixSignalSettings,
  serializeSchedulingIntent,
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
  if (err instanceof ConflictError) {
    return c.json(
      { error: err.code, message: err.message, details: err.details ?? null },
      409,
    )
  }
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
    createSignalCharge: (caller, input, deps) =>
      stub.createSignalChargeAndSend(caller, input, deps),
    reconcileCharge: (caller, chargeId, deps) =>
      stub.reconcilePixChargeCreate(caller, chargeId, deps),
    confirmWithoutSignal: (caller, input, deps) =>
      stub.confirmAppointmentWithoutSignal(caller, input, deps),
    getChargeDetail: (caller, chargeId) => stub.getPixChargeDetail(caller, chargeId),
    listConversationCharges: (caller, conversationId) =>
      stub.listConversationPixCharges(caller, conversationId),
  }
}

function defaultChargeDeps(env: WorkerBindings): PixChargeCreateDeps {
  return {
    tokenSecret: env.PIX_TOKEN_SECRET,
    environment: resolvePixMode(env),
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

  /** Criar cobrança + enviar sinal sem reservar (#38 / AC-46). */
  app.post('/api/tenants/:tenantId/pix/charges', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      const principal = c.get('principal')
      requireClinicPermission(ctx, 'clinic.agenda.operate')
      const body = (await c.req.json()) as {
        clientRequestId?: string
        conversationId?: string
        contactId?: string | null
        opportunityId?: string | null
        serviceId?: string
        professionalId?: string
        roomResourceId?: string | null
        startsAt?: number
        authorDisplayName?: string | null
      }
      if (!body.clientRequestId || !body.conversationId || !body.serviceId
        || !body.professionalId || typeof body.startsAt !== 'number') {
        throw new ValidationError(
          'invalid_charge_input',
          'clientRequestId, conversationId, serviceId, professionalId e startsAt são obrigatórios',
        )
      }
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      if (!gw.createSignalCharge) {
        throw new ValidationError('not_supported', 'Gateway sem createSignalCharge')
      }
      const deps = (opts.connectDepsFactory ?? defaultChargeDeps)(c.env)
      const result = await gw.createSignalCharge(
        workerCaller(ctx.tenantId, principal.clerkUserId),
        {
          clientRequestId: body.clientRequestId,
          conversationId: body.conversationId,
          contactId: body.contactId,
          opportunityId: body.opportunityId,
          serviceId: body.serviceId,
          professionalId: body.professionalId,
          roomResourceId: body.roomResourceId,
          startsAt: body.startsAt,
          actorClerkUserId: principal.clerkUserId,
          authorDisplayName: body.authorDisplayName,
        },
        deps,
      )
      return c.json({
        charge: serializePixChargeDetail(result.charge),
        intent: serializeSchedulingIntent(result.intent),
        messageId: result.messageId,
        whatsappSendError: result.whatsappSendError,
        idempotentReplay: result.idempotentReplay,
      })
    } catch (err) {
      return pixErrorResponse(c, err)
    }
  })

  app.get('/api/tenants/:tenantId/pix/charges/:chargeId', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      const principal = c.get('principal')
      requireClinicPermission(ctx, 'clinic.context.read')
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      if (!gw.getChargeDetail) {
        throw new ValidationError('not_supported', 'Gateway sem getChargeDetail')
      }
      const detail = await gw.getChargeDetail(
        workerCaller(ctx.tenantId, principal.clerkUserId),
        c.req.param('chargeId'),
      )
      return c.json({
        charge: serializePixChargeDetail(detail.charge),
        intent: detail.intent
          ? serializeSchedulingIntent(detail.intent)
          : null,
      })
    } catch (err) {
      return pixErrorResponse(c, err)
    }
  })

  app.post(
    '/api/tenants/:tenantId/pix/charges/:chargeId/reconcile',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.agenda.operate')
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        if (!gw.reconcileCharge) {
          throw new ValidationError('not_supported', 'Gateway sem reconcileCharge')
        }
        const deps = (opts.connectDepsFactory ?? defaultChargeDeps)(c.env)
        const result = await gw.reconcileCharge(
          workerCaller(ctx.tenantId, principal.clerkUserId),
          c.req.param('chargeId'),
          deps,
        )
        return c.json({
          charge: serializePixChargeDetail(result.charge),
          intent: result.intent?.id
            ? serializeSchedulingIntent(result.intent)
            : null,
          idempotentReplay: result.idempotentReplay,
        })
      } catch (err) {
        return pixErrorResponse(c, err)
      }
    },
  )

  app.get(
    '/api/tenants/:tenantId/conversations/:conversationId/pix-charges',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.context.read')
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        if (!gw.listConversationCharges) {
          throw new ValidationError(
            'not_supported',
            'Gateway sem listConversationCharges',
          )
        }
        const items = await gw.listConversationCharges(
          workerCaller(ctx.tenantId, principal.clerkUserId),
          c.req.param('conversationId'),
        )
        return c.json({
          items: items.map(serializePixChargeDetail),
        })
      } catch (err) {
        return pixErrorResponse(c, err)
      }
    },
  )

  /** Confirmar sem sinal com motivo (AC-51). */
  app.post(
    '/api/tenants/:tenantId/appointments/confirm-without-signal',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.agenda.operate')
        const body = (await c.req.json()) as {
          clientRequestId?: string
          conversationId?: string | null
          contactId?: string | null
          opportunityId?: string | null
          serviceId?: string
          professionalId?: string
          roomResourceId?: string | null
          startsAt?: number
          contactLabel?: string | null
          waiveReason?: string
          supersedeChargeId?: string | null
        }
        if (!body.clientRequestId || !body.serviceId || !body.professionalId
          || typeof body.startsAt !== 'number') {
          throw new ValidationError(
            'invalid_confirm_input',
            'clientRequestId, serviceId, professionalId e startsAt são obrigatórios',
          )
        }
        if (!body.waiveReason?.trim()) {
          throw new ValidationError(
            'waive_reason_required',
            'Motivo obrigatório para confirmar sem sinal (AC-51)',
          )
        }
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        if (!gw.confirmWithoutSignal) {
          throw new ValidationError(
            'not_supported',
            'Gateway sem confirmWithoutSignal',
          )
        }
        const deps = (opts.connectDepsFactory ?? defaultChargeDeps)(c.env)
        const result = await gw.confirmWithoutSignal(
          workerCaller(ctx.tenantId, principal.clerkUserId),
          {
            clientRequestId: body.clientRequestId,
            conversationId: body.conversationId,
            contactId: body.contactId,
            opportunityId: body.opportunityId,
            serviceId: body.serviceId,
            professionalId: body.professionalId,
            roomResourceId: body.roomResourceId,
            startsAt: body.startsAt,
            contactLabel: body.contactLabel,
            waiveReason: body.waiveReason,
            actorClerkUserId: principal.clerkUserId,
            supersedeChargeId: body.supersedeChargeId,
          },
          deps,
        )
        return c.json({
          appointmentId: result.appointmentId,
          supersededChargeId: result.supersededChargeId,
          intent: result.intent
            ? serializeSchedulingIntent(result.intent)
            : null,
          appointment: result.detail,
          idempotentReplay: result.idempotentReplay,
        })
      } catch (err) {
        return pixErrorResponse(c, err)
      }
    },
  )

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
