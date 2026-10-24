/**
 * Rotas de disponibilidade da agenda (#35 / REQ-030; DEC-008/014).
 * Leitura: owner + attendant (`clinic.agenda.operate`).
 * Consulta e check NÃO criam reserva (confirmação atómica = #36).
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
import type { SchedulingGateway } from './gateway'
import { serializeAvailability, serializeCheckSlot } from './serialize'

type SchedulingEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type SchedulingRouteOptions = {
  gatewayFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => SchedulingGateway | Promise<SchedulingGateway>
}

function schedulingErrorResponse(
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
    { error: err instanceof Error ? err.message : 'scheduling_error' },
    400,
  )
}

function createDoGateway(env: WorkerBindings, tenantId: string): SchedulingGateway {
  const stub = env.CLINIC.get(env.CLINIC.idFromName(tenantId))
  return {
    queryAvailability: (caller, input) => stub.queryClinicAvailability(caller, input),
    checkSlot: (caller, input) => stub.checkClinicSlot(caller, input),
  }
}

async function resolveGateway(
  env: WorkerBindings,
  tenantId: string,
  opts: SchedulingRouteOptions,
): Promise<SchedulingGateway> {
  if (opts.gatewayFactory) {
    return opts.gatewayFactory(env, tenantId)
  }
  return createDoGateway(env, tenantId)
}

function callerFromContext(tenantId: string, actorId: string) {
  return workerCaller(tenantId, actorId)
}

export function createSchedulingRoutes(opts: SchedulingRouteOptions = {}) {
  const app = new Hono<SchedulingEnv>()

  const tenant = [
    requireAuth(),
    requireTenantAccess({ param: 'tenantId' }),
  ] as const

  app.get('/api/tenants/:tenantId/availability', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.agenda.operate')
      const serviceId = c.req.query('serviceId')?.trim()
      const date = c.req.query('date')?.trim()
      const professionalId = c.req.query('professionalId')?.trim() || undefined
      if (!serviceId || !date) {
        throw new ValidationError(
          'missing_query',
          'serviceId e date (YYYY-MM-DD) são obrigatórios',
        )
      }
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const result = await gw.queryAvailability(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        { serviceId, date, professionalId },
      )
      return c.json(serializeAvailability(result))
    } catch (err) {
      return schedulingErrorResponse(c, err)
    }
  })

  app.post('/api/tenants/:tenantId/availability/check', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.agenda.operate')
      const body = await c.req.json<{
        serviceId?: string
        professionalId?: string
        roomResourceId?: string | null
        startsAt?: number
      }>()
      if (!body.serviceId?.trim() || !body.professionalId?.trim()) {
        throw new ValidationError(
          'missing_body',
          'serviceId e professionalId são obrigatórios',
        )
      }
      if (!Number.isFinite(body.startsAt)) {
        throw new ValidationError('missing_body', 'startsAt (epoch ms) é obrigatório')
      }
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const result = await gw.checkSlot(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        {
          serviceId: body.serviceId.trim(),
          professionalId: body.professionalId.trim(),
          roomResourceId: body.roomResourceId ?? null,
          startsAt: body.startsAt!,
        },
      )
      return c.json(serializeCheckSlot(result))
    } catch (err) {
      return schedulingErrorResponse(c, err)
    }
  })

  return app
}
