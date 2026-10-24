/**
 * Rotas de disponibilidade + agendamento atómico (#35/#36).
 * Permissão: `clinic.agenda.operate` (owner + attendant).
 * Mensagem WhatsApp fica no inbox (#33) — falha de envio não toca reserva (REQ-033).
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
import type { AppointmentChangeReason } from '../clinic/constants'
import type { WorkerBindings } from '../worker/bindings'
import type { SchedulingGateway } from './gateway'
import {
  serializeAgendaView,
  serializeAppointmentDetail,
  serializeAvailability,
  serializeChangeReasons,
  serializeCheckSlot,
} from './serialize'

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
  if (err instanceof ConflictError) {
    return c.json(
      {
        error: err.code,
        message: err.message,
        details: err.details ?? null,
      },
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
    { error: err instanceof Error ? err.message : 'scheduling_error' },
    400,
  )
}

function createDoGateway(env: WorkerBindings, tenantId: string): SchedulingGateway {
  const stub = env.CLINIC.get(env.CLINIC.idFromName(tenantId))
  return {
    queryAvailability: (caller, input) => stub.queryClinicAvailability(caller, input),
    checkSlot: (caller, input) => stub.checkClinicSlot(caller, input),
    confirmAppointment: (caller, input) => stub.confirmClinicAppointment(caller, input),
    cancelAppointment: (caller, input) => stub.cancelClinicAppointment(caller, input),
    rescheduleAppointment: (caller, input) =>
      stub.rescheduleClinicAppointment(caller, input),
    getAppointment: (caller, appointmentId) =>
      stub.getClinicAppointment(caller, appointmentId),
    queryAgenda: (caller, input) => stub.queryClinicAgenda(caller, input),
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
        excludeAppointmentId?: string | null
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
          excludeAppointmentId: body.excludeAppointmentId ?? null,
        },
      )
      return c.json(serializeCheckSlot(result))
    } catch (err) {
      return schedulingErrorResponse(c, err)
    }
  })

  app.get('/api/tenants/:tenantId/appointments/reasons', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.agenda.operate')
      return c.json({ reasons: serializeChangeReasons() })
    } catch (err) {
      return schedulingErrorResponse(c, err)
    }
  })

  app.get('/api/tenants/:tenantId/agenda', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.agenda.operate')
      const date = c.req.query('date')?.trim()
      const view = (c.req.query('view')?.trim() || 'day') as 'day' | 'week'
      if (!date) {
        throw new ValidationError('missing_query', 'date (YYYY-MM-DD) é obrigatório')
      }
      if (view !== 'day' && view !== 'week') {
        throw new ValidationError('invalid_view', 'view deve ser day ou week')
      }
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const result = await gw.queryAgenda(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        {
          date,
          view,
          professionalId: c.req.query('professionalId')?.trim() || null,
          roomResourceId: c.req.query('roomResourceId')?.trim() || null,
          includeCancelled: c.req.query('includeCancelled') === '1',
        },
      )
      return c.json(serializeAgendaView(result))
    } catch (err) {
      return schedulingErrorResponse(c, err)
    }
  })

  app.get('/api/tenants/:tenantId/appointments/:appointmentId', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.agenda.operate')
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const detail = await gw.getAppointment(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        c.req.param('appointmentId'),
      )
      return c.json(serializeAppointmentDetail(detail))
    } catch (err) {
      return schedulingErrorResponse(c, err)
    }
  })

  app.post('/api/tenants/:tenantId/appointments', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.agenda.operate')
      const body = await c.req.json<{
        clientRequestId?: string
        serviceId?: string
        professionalId?: string
        roomResourceId?: string | null
        startsAt?: number
        contactLabel?: string | null
        contactId?: string | null
        conversationId?: string | null
        opportunityId?: string | null
      }>()
      if (!body.clientRequestId?.trim()) {
        throw new ValidationError(
          'client_request_id_required',
          'clientRequestId obrigatório',
        )
      }
      if (!body.serviceId?.trim() || !body.professionalId?.trim()) {
        throw new ValidationError(
          'missing_body',
          'serviceId e professionalId são obrigatórios',
        )
      }
      if (!Number.isFinite(body.startsAt)) {
        throw new ValidationError('missing_body', 'startsAt é obrigatório')
      }
      const actor = c.get('principal').clerkUserId
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const result = await gw.confirmAppointment(
        callerFromContext(ctx.tenantId, actor),
        {
          clientRequestId: body.clientRequestId.trim(),
          serviceId: body.serviceId.trim(),
          professionalId: body.professionalId.trim(),
          roomResourceId: body.roomResourceId ?? null,
          startsAt: body.startsAt!,
          contactLabel: body.contactLabel ?? null,
          contactId: body.contactId ?? null,
          conversationId: body.conversationId ?? null,
          opportunityId: body.opportunityId ?? null,
          actorClerkUserId: actor,
        },
      )
      return c.json(
        {
          ...serializeAppointmentDetail(result.value),
          createdReservation: true as const,
          idempotentReplay: result.idempotentReplay,
        },
        result.idempotentReplay ? 200 : 201,
      )
    } catch (err) {
      return schedulingErrorResponse(c, err)
    }
  })

  app.post(
    '/api/tenants/:tenantId/appointments/:appointmentId/cancel',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.agenda.operate')
        const body = await c.req.json<{
          clientRequestId?: string
          reason?: string
          expectedVersion?: number | null
        }>()
        if (!body.clientRequestId?.trim()) {
          throw new ValidationError(
            'client_request_id_required',
            'clientRequestId obrigatório',
          )
        }
        if (!body.reason?.trim()) {
          throw new ValidationError(
            'change_reason_required',
            'Motivo obrigatório (REQ-032)',
          )
        }
        const actor = c.get('principal').clerkUserId
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const result = await gw.cancelAppointment(
          callerFromContext(ctx.tenantId, actor),
          {
            clientRequestId: body.clientRequestId.trim(),
            appointmentId: c.req.param('appointmentId'),
            reason: body.reason.trim() as AppointmentChangeReason,
            actorClerkUserId: actor,
            expectedVersion: body.expectedVersion ?? null,
          },
        )
        return c.json({
          ...serializeAppointmentDetail(result.value),
          idempotentReplay: result.idempotentReplay,
        })
      } catch (err) {
        return schedulingErrorResponse(c, err)
      }
    },
  )

  app.post(
    '/api/tenants/:tenantId/appointments/:appointmentId/reschedule',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.agenda.operate')
        const body = await c.req.json<{
          clientRequestId?: string
          reason?: string
          serviceId?: string
          professionalId?: string
          roomResourceId?: string | null
          startsAt?: number
          expectedVersion?: number | null
        }>()
        if (!body.clientRequestId?.trim()) {
          throw new ValidationError(
            'client_request_id_required',
            'clientRequestId obrigatório',
          )
        }
        if (!body.reason?.trim()) {
          throw new ValidationError(
            'change_reason_required',
            'Motivo obrigatório (REQ-032)',
          )
        }
        if (!body.professionalId?.trim() || !Number.isFinite(body.startsAt)) {
          throw new ValidationError(
            'missing_body',
            'professionalId e startsAt são obrigatórios',
          )
        }
        const actor = c.get('principal').clerkUserId
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const result = await gw.rescheduleAppointment(
          callerFromContext(ctx.tenantId, actor),
          {
            clientRequestId: body.clientRequestId.trim(),
            appointmentId: c.req.param('appointmentId'),
            reason: body.reason.trim() as AppointmentChangeReason,
            serviceId: body.serviceId?.trim(),
            professionalId: body.professionalId.trim(),
            roomResourceId: body.roomResourceId ?? null,
            startsAt: body.startsAt!,
            actorClerkUserId: actor,
            expectedVersion: body.expectedVersion ?? null,
          },
        )
        return c.json({
          ...serializeAppointmentDetail(result.value),
          idempotentReplay: result.idempotentReplay,
        })
      } catch (err) {
        return schedulingErrorResponse(c, err)
      }
    },
  )

  return app
}
