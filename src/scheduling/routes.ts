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

function parseZoneIds(raw: unknown): string[] | null {
  if (raw == null) return null
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new ValidationError('invalid_zone_ids', 'zoneIds deve ser uma lista de ids')
  }
  return raw as string[]
}
import type { WorkerBindings } from '../worker/bindings'
import type { SchedulingGateway } from './gateway'
import {
  serializeHold,
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
    previewHold: (caller, input) => stub.previewClinicHold(caller, input),
    createHold: (caller, input) => stub.createClinicHold(caller, input),
    listHolds: (caller, input) => stub.listClinicHolds(caller, input),
    createAndSendProposal: (caller, input) => stub.createAndSendStaffProposal(caller, input),
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

function displayNameFromRole(role: string): string {
  return role === 'owner' ? 'Responsável' : 'Atendente'
}

function finiteNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ValidationError('missing_body', `${field} (número) é obrigatório`)
  }
  return v
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
      const excludeHoldId = c.req.query('excludeHoldId')?.trim() || undefined
      const durationRaw = c.req.query('durationMinutes')?.trim()
      const durationMinutesOverride = durationRaw
        ? finiteNumber(Number(durationRaw), 'durationMinutes')
        : undefined
      if (!serviceId || !date) {
        throw new ValidationError(
          'missing_query',
          'serviceId e date (YYYY-MM-DD) são obrigatórios',
        )
      }
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const result = await gw.queryAvailability(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        {
          serviceId,
          date,
          professionalId,
          excludeHoldId,
          durationMinutesOverride,
          tempoMode: 'equipe',
        },
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
        excludeHoldId?: string | null
        durationMinutes?: number | null
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
          excludeHoldId: body.excludeHoldId ?? null,
          durationMinutesOverride:
            body.durationMinutes == null ? null : finiteNumber(body.durationMinutes, 'durationMinutes'),
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

  /**
   * DEC-061 (Paulo, 31/10/2026): Agendar envia proposta versionada com botões.
   * Não cria compromisso nem muda etapa — só o clique da cliente marca.
   */
  app.post('/api/tenants/:tenantId/appointment-proposals', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.agenda.operate')
      const body = await c.req.json<{
        clientRequestId?: string
        contactId?: string
        conversationId?: string
        serviceId?: string
        professionalId?: string | null
        startsAt?: number
        endsAt?: number
        durationMinutes?: number
        zoneIds?: unknown
      }>()
      if (!body.contactId?.trim() || !body.conversationId?.trim()) {
        throw new ValidationError(
          'proposal_requires_conversation',
          'contactId e conversationId são obrigatórios',
        )
      }
      if (!body.serviceId?.trim()) {
        throw new ValidationError('missing_service', 'serviceId é obrigatório')
      }
      if (!Number.isFinite(body.startsAt)) {
        throw new ValidationError('missing_body', 'startsAt é obrigatório')
      }
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const result = await gw.createAndSendProposal(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        {
          clientRequestId: body.clientRequestId?.trim(),
          contactId: body.contactId.trim(),
          conversationId: body.conversationId.trim(),
          serviceId: body.serviceId.trim(),
          professionalId: body.professionalId ?? null,
          startsAt: body.startsAt!,
          endsAt: body.endsAt,
          durationMinutes: body.durationMinutes,
          zoneIds: parseZoneIds(body.zoneIds),
        },
      )
      const p = result.proposal
      return c.json(
        {
          appointmentCreated: false as const,
          sendStatus: result.sendStatus,
          proposal: {
            id: p.id,
            version: p.version,
            state: p.state,
            serviceName: p.serviceName,
            startsAt: p.startsAt,
            endsAt: p.endsAt,
            expiresAt: p.expiresAt,
            requiresSignal: p.requiresSignal,
            resultKind: p.resultKind,
            sendProviderMessageId: p.sendProviderMessageId,
          },
        },
        201,
      )
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
        durationMinutes?: number | null
        zoneIds?: unknown
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
          actorDisplayName: displayNameFromRole(ctx.role),
          appliedDurationMinutes:
            body.durationMinutes == null ? null : finiteNumber(body.durationMinutes, 'durationMinutes'),
          zoneIds: parseZoneIds(body.zoneIds),
        },
      )
      return c.json(
        {
          ...serializeAppointmentDetail(result.value),
          createdReservation: true as const,
          idempotentReplay: result.idempotentReplay,
          tempoWarnings: result.tempoWarnings ?? [],
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
          cancelNotice: result.cancelNotice ?? 'skipped',
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
          zoneIds?: unknown
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
            zoneIds: parseZoneIds(body.zoneIds),
          },
        )
        return c.json({
          ...serializeAppointmentDetail(result.value),
          idempotentReplay: result.idempotentReplay,
          tempoWarnings: result.tempoWarnings ?? [],
          rescheduleNotice: result.rescheduleNotice ?? 'skipped',
        })
      } catch (err) {
        return schedulingErrorResponse(c, err)
      }
    },
  )

  // ── Reserva por bloco ────────────────────────────────────────────────
  app.post('/api/tenants/:tenantId/holds/preview', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.agenda.operate')
      const body = await c.req.json<Record<string, unknown>>()
      const professionalId = typeof body.professionalId === 'string' ? body.professionalId.trim() : ''
      if (!professionalId) throw new ValidationError('missing_body', 'professionalId é obrigatório')
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const result = await gw.previewHold(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        {
          professionalId,
          windowStartsAt: finiteNumber(body.windowStartsAt, 'windowStartsAt'),
          windowEndsAt: finiteNumber(body.windowEndsAt, 'windowEndsAt'),
          durationMinutes: finiteNumber(body.durationMinutes, 'durationMinutes'),
        },
      )
      return c.json(result)
    } catch (err) {
      return schedulingErrorResponse(c, err)
    }
  })

  app.get('/api/tenants/:tenantId/holds', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.agenda.operate')
      const statusParam = c.req.query('status')?.trim()
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const holds = await gw.listHolds(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        {
          conversationId: c.req.query('conversationId')?.trim() || null,
          professionalId: c.req.query('professionalId')?.trim() || null,
          statuses: statusParam ? statusParam.split(',').map((x) => x.trim()) : null,
        },
      )
      return c.json({ holds: holds.map(serializeHold) })
    } catch (err) {
      return schedulingErrorResponse(c, err)
    }
  })

  app.post('/api/tenants/:tenantId/holds', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.agenda.operate')
      const body = await c.req.json<Record<string, unknown>>()
      const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')
      if (!str('clientRequestId')) {
        throw new ValidationError('client_request_id_required', 'clientRequestId obrigatório')
      }
      if (!str('conversationId') || !str('serviceId') || !str('professionalId')) {
        throw new ValidationError(
          'missing_body',
          'conversationId, serviceId e professionalId são obrigatórios',
        )
      }
      const actor = c.get('principal').clerkUserId
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const result = await gw.createHold(callerFromContext(ctx.tenantId, actor), {
        clientRequestId: str('clientRequestId'),
        conversationId: str('conversationId'),
        serviceId: str('serviceId'),
        professionalId: str('professionalId'),
        windowStartsAt: finiteNumber(body.windowStartsAt, 'windowStartsAt'),
        windowEndsAt: finiteNumber(body.windowEndsAt, 'windowEndsAt'),
        durationMinutes: finiteNumber(body.durationMinutes, 'durationMinutes'),
        startsAt: finiteNumber(body.startsAt, 'startsAt'),
        roomResourceId: typeof body.roomResourceId === 'string' ? body.roomResourceId : null,
        actorClerkUserId: actor,
        actorDisplayName: displayNameFromRole(ctx.role),
      })
      return c.json(
        {
          hold: serializeHold(result.value.hold),
          appointment: serializeAppointmentDetail(result.value.appointment),
          idempotentReplay: result.idempotentReplay === true,
        },
        result.idempotentReplay ? 200 : 201,
      )
    } catch (err) {
      return schedulingErrorResponse(c, err)
    }
  })

  return app
}
