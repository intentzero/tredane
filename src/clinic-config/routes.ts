/**
 * Rotas de configuração da clínica (#28 / DEC-008/014/042/046).
 * Leituras: owner + attendant. Escritas: só owner (clinic.config.write).
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
import { isVariantAudience } from '../clinic/config/types'
import type { ClinicConfigGateway } from './gateway'
import {
  serializeAbuseLimits,
  serializeBlockResult,
  serializeReadiness,
  serializeResource,
  serializeService,
  serializeSettings,
  serializeSnapshot,
  serializeWindow,
} from './serialize'
import type { UpdateAbuseLimitsInput } from '../clinic/config'

type ConfigEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type ClinicConfigRouteOptions = {
  /**
   * Injeta gateway (testes com SQLite em memória).
   * Produção: RPC ao Clinic DO.
   */
  gatewayFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => ClinicConfigGateway | Promise<ClinicConfigGateway>
}

function configErrorResponse(
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
    return c.json(
      { error: err.code, message: err.message, details: err.details ?? null },
      409,
    )
  }
  if (err instanceof ClinicError) {
    const status =
      err.code === 'tenant_mismatch' || err.code === 'unauthorized_caller'
        ? 403
        : 400
    return c.json({ error: err.code, message: err.message }, status)
  }
  // Falha inesperada (ex.: cota do Durable Object): vai para o log, nunca para a resposta.
  console.error('clinic-config: erro inesperado', err)
  return c.json({ error: 'internal_error' }, 500)
}

function createDoGateway(env: WorkerBindings, tenantId: string): ClinicConfigGateway {
  const stub = env.CLINIC.get(env.CLINIC.idFromName(tenantId))
  return {
    getSnapshot: (caller) => stub.getConfigSnapshot(caller),
    getReadiness: (caller) => stub.getConfigReadiness(caller),
    updateTimezone: (caller, timezone) => stub.updateClinicTimezone(caller, timezone),
    setAiAssistEnabled: (caller, enabled) => stub.setClinicAiAssistEnabled(caller, enabled),
    setAiProfile: (caller, input) => stub.setClinicAiProfile(caller, input),
    setForecastPlace: (caller, input) => stub.setForecastPlace(caller, input),
    getAbuseLimits: (caller) => stub.getClinicAbuseLimits(caller),
    updateAbuseLimits: (caller, input) => stub.updateClinicAbuseLimits(caller, input),
    upsertService: (caller, input) => stub.upsertClinicService(caller, input),
    replaceServiceZones: (caller, serviceId, zones) =>
      stub.replaceClinicServiceZones(caller, serviceId, zones),
    setServiceActive: (caller, serviceId, active) =>
      stub.setClinicServiceActive(caller, serviceId, active),
    deleteService: (caller, serviceId) => stub.deleteClinicService(caller, serviceId),
    upsertResource: (caller, input) => stub.upsertClinicResource(caller, input),
    setResourceActive: (caller, resourceId, active) =>
      stub.setClinicResourceActive(caller, resourceId, active),
    listResourceFutureAppointments: (caller, resourceId) =>
      stub.listClinicResourceFutureAppointments(caller, resourceId),
    deactivateResource: (caller, input) => stub.deactivateClinicResource(caller, input),
    deleteResource: (caller, resourceId) => stub.deleteClinicResource(caller, resourceId),
    setWeeklyWindows: (caller, input) => stub.setClinicWeeklyWindows(caller, input),
    createBlock: (caller, input) => stub.createClinicBlock(caller, input),
    deleteBlock: (caller, blockId) => stub.deleteClinicBlock(caller, blockId),
    allowBothSexesInBlock: (caller, input) =>
      stub.allowBothSexesInClinicBlock(caller, input),
    insertAppointment: (caller, input) =>
      stub.insertSyntheticAppointmentForTests(caller, input),
  }
}

async function resolveGateway(
  env: WorkerBindings,
  tenantId: string,
  opts: ClinicConfigRouteOptions,
): Promise<ClinicConfigGateway> {
  if (opts.gatewayFactory) {
    return opts.gatewayFactory(env, tenantId)
  }
  return createDoGateway(env, tenantId)
}

function callerFromContext(tenantId: string, actorId: string) {
  return workerCaller(tenantId, actorId)
}

export function createClinicConfigRoutes(opts: ClinicConfigRouteOptions = {}) {
  const app = new Hono<ConfigEnv>()

  const tenant = [
    requireAuth(),
    requireTenantAccess({ param: 'tenantId' }),
  ] as const

  app.get('/api/tenants/:tenantId/config', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.context.read')
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const snap = await gw.getSnapshot(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
      )
      return c.json(serializeSnapshot(snap))
    } catch (err) {
      return configErrorResponse(c, err)
    }
  })

  app.get('/api/tenants/:tenantId/config/readiness', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.context.read')
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const readiness = await gw.getReadiness(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
      )
      return c.json(serializeReadiness(readiness))
    } catch (err) {
      return configErrorResponse(c, err)
    }
  })

  app.patch('/api/tenants/:tenantId/config/settings', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      const body = await c.req.json<{ timezone?: string }>()
      if (!body?.timezone || typeof body.timezone !== 'string') {
        return c.json({ error: 'invalid_body' }, 400)
      }
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const settings = await gw.updateTimezone(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        body.timezone,
      )
      return c.json(serializeSettings(settings))
    } catch (err) {
      return configErrorResponse(c, err)
    }
  })

  // Limites de abuso / automações: só o responsável (GET+PATCH owner-only; attendants 403).
  app.get('/api/tenants/:tenantId/config/abuse-limits', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const view = await gw.getAbuseLimits(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
      )
      return c.json(serializeAbuseLimits(view))
    } catch (err) {
      return configErrorResponse(c, err)
    }
  })

  app.patch('/api/tenants/:tenantId/config/abuse-limits', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      const body = await c.req.json<Record<string, unknown>>().catch(() => null)
      if (!body || typeof body !== 'object') {
        return c.json({ error: 'invalid_body' }, 400)
      }
      const input = parseAbuseLimitsBody(body)
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const view = await gw.updateAbuseLimits(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        input,
      )
      return c.json(serializeAbuseLimits(view))
    } catch (err) {
      return configErrorResponse(c, err)
    }
  })

  // Opt-in de IA por clínica: só o responsável (clinic.config.write).
  app.put('/api/tenants/:tenantId/config/ai-assist', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      const body = await c.req
        .json<{
          enabled?: unknown
          clinicAddress?: unknown
          googleBusinessUrl?: unknown
          reschedulePolicy?: unknown
        }>()
        .catch(() => null)
      const hasProfile =
        body != null &&
        (typeof body.clinicAddress === 'string' ||
          typeof body.googleBusinessUrl === 'string' ||
          typeof body.reschedulePolicy === 'string')
      if (!body || (typeof body.enabled !== 'boolean' && !hasProfile)) {
        return c.json({ error: 'invalid_body' }, 400)
      }
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const caller = callerFromContext(ctx.tenantId, c.get('principal').clerkUserId)
      let settings = null
      if (hasProfile) {
        settings = await gw.setAiProfile(caller, {
          clinicAddress: typeof body.clinicAddress === 'string' ? body.clinicAddress : null,
          googleBusinessUrl:
            typeof body.googleBusinessUrl === 'string' ? body.googleBusinessUrl : null,
          reschedulePolicy:
            typeof body.reschedulePolicy === 'string' ? body.reschedulePolicy : null,
        })
      }
      if (typeof body.enabled === 'boolean') {
        settings = await gw.setAiAssistEnabled(caller, body.enabled)
      }
      return c.json(serializeSettings(settings!))
    } catch (err) {
      return configErrorResponse(c, err)
    }
  })

  app.put('/api/tenants/:tenantId/config/forecast-place', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      const body = await c.req.json<Record<string, unknown>>().catch(() => null)
      if (!body || typeof body !== 'object') {
        return c.json({ error: 'invalid_body' }, 400)
      }
      const input = parseForecastPlaceBody(body)
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const settings = await gw.setForecastPlace(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        input,
      )
      return c.json(serializeSettings(settings))
    } catch (err) {
      return configErrorResponse(c, err)
    }
  })

  app.post('/api/tenants/:tenantId/config/services', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      const body = await c.req.json<Record<string, unknown>>()
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const row = await gw.upsertService(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        parseServiceBody(body),
      )
      return c.json(serializeService(row), 201)
    } catch (err) {
      return configErrorResponse(c, err)
    }
  })

  app.put('/api/tenants/:tenantId/config/services/:serviceId', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      const body = await c.req.json<Record<string, unknown>>()
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const row = await gw.upsertService(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        { ...parseServiceBody(body), id: c.req.param('serviceId') },
      )
      return c.json(serializeService(row))
    } catch (err) {
      return configErrorResponse(c, err)
    }
  })

  app.put('/api/tenants/:tenantId/config/services/:serviceId/zones', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      const body = await c.req.json<{ zones?: unknown }>()
      if (!Array.isArray(body.zones)) {
        throw new ValidationError('invalid_zones', 'zones deve ser uma lista')
      }
      const zones = body.zones.map((raw) => {
        if (!raw || typeof raw !== 'object') {
          throw new ValidationError('invalid_zones', 'zona inválida')
        }
        const z = raw as Record<string, unknown>
        if (typeof z.name !== 'string') {
          throw new ValidationError('invalid_zones', 'nome da variante é obrigatório')
        }
        if (!isVariantAudience(z.audience)) {
          throw new ValidationError(
            'invalid_variant_audience',
            'cada variante é masculina, feminina ou ambos',
          )
        }
        return {
          id: typeof z.id === 'string' ? z.id : undefined,
          name: z.name,
          durationMinutes: typeof z.durationMinutes === 'number' ? z.durationMinutes : undefined,
          priceCents:
            z.priceCents === null ? null : typeof z.priceCents === 'number' ? z.priceCents : undefined,
          active: typeof z.active === 'boolean' ? z.active : undefined,
          audience: z.audience,
        }
      })
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const row = await gw.replaceServiceZones(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        c.req.param('serviceId'),
        zones,
      )
      return c.json(serializeService(row))
    } catch (err) {
      return configErrorResponse(c, err)
    }
  })

  app.patch(
    '/api/tenants/:tenantId/config/services/:serviceId/active',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const body = await c.req.json<{ active?: boolean }>()
        if (typeof body?.active !== 'boolean') {
          return c.json({ error: 'invalid_body' }, 400)
        }
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const row = await gw.setServiceActive(
          callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
          c.req.param('serviceId'),
          body.active,
        )
        return c.json(serializeService(row))
      } catch (err) {
        return configErrorResponse(c, err)
      }
    },
  )

  app.delete(
    '/api/tenants/:tenantId/config/services/:serviceId',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const out = await gw.deleteService(
          callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
          c.req.param('serviceId'),
        )
        return c.json(out)
      } catch (err) {
        return configErrorResponse(c, err)
      }
    },
  )

  app.post('/api/tenants/:tenantId/config/resources', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      const body = await c.req.json<Record<string, unknown>>()
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const row = await gw.upsertResource(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        parseResourceBody(body),
      )
      return c.json(serializeResource(row), 201)
    } catch (err) {
      return configErrorResponse(c, err)
    }
  })

  app.put(
    '/api/tenants/:tenantId/config/resources/:resourceId',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const body = await c.req.json<Record<string, unknown>>()
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const row = await gw.upsertResource(
          callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
          { ...parseResourceBody(body), id: c.req.param('resourceId') },
        )
        return c.json(serializeResource(row))
      } catch (err) {
        return configErrorResponse(c, err)
      }
    },
  )

  app.patch(
    '/api/tenants/:tenantId/config/resources/:resourceId/active',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const body = await c.req.json<{ active?: boolean }>()
        if (typeof body?.active !== 'boolean') {
          return c.json({ error: 'invalid_body' }, 400)
        }
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const row = await gw.setResourceActive(
          callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
          c.req.param('resourceId'),
          body.active,
        )
        return c.json(serializeResource(row))
      } catch (err) {
        return configErrorResponse(c, err)
      }
    },
  )

  app.get(
    '/api/tenants/:tenantId/config/resources/:resourceId/future-appointments',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const out = await gw.listResourceFutureAppointments(
          callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
          c.req.param('resourceId'),
        )
        return c.json({
          resource: serializeResource(out.resource),
          appointments: out.appointments,
        })
      } catch (err) {
        return configErrorResponse(c, err)
      }
    },
  )

  app.post(
    '/api/tenants/:tenantId/config/resources/:resourceId/deactivate',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const body = await c.req
          .json<{ reassignments?: unknown }>()
          .catch(() => ({}) as { reassignments?: unknown })
        const raw = body?.reassignments ?? []
        if (!Array.isArray(raw)) return c.json({ error: 'invalid_body' }, 400)
        const reassignments = raw.map((r) => {
          const item = (r ?? {}) as Record<string, unknown>
          return {
            appointmentId: String(item.appointmentId ?? ''),
            targetResourceId: String(item.targetResourceId ?? ''),
            expectedVersion:
              typeof item.expectedVersion === 'number' ? item.expectedVersion : undefined,
          }
        })
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const row = await gw.deactivateResource(
          callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
          { resourceId: c.req.param('resourceId'), reassignments },
        )
        return c.json({
          ...serializeResource(row),
          reassigned: row.reassigned,
          keptAppointmentIds: row.keptAppointmentIds,
        })
      } catch (err) {
        return configErrorResponse(c, err)
      }
    },
  )

  app.delete(
    '/api/tenants/:tenantId/config/resources/:resourceId',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const out = await gw.deleteResource(
          callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
          c.req.param('resourceId'),
        )
        return c.json(out)
      } catch (err) {
        return configErrorResponse(c, err)
      }
    },
  )

  app.put(
    '/api/tenants/:tenantId/config/resources/:resourceId/weekly',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const body = await c.req.json<{ windows?: unknown }>()
        if (!Array.isArray(body?.windows)) {
          return c.json({ error: 'invalid_body' }, 400)
        }
        const windows = body.windows.map((w) => {
          const item = w as Record<string, unknown>
          return {
            dayOfWeek: Number(item.dayOfWeek),
            startMinute: Number(item.startMinute),
            endMinute: Number(item.endMinute),
          }
        })
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const rows = await gw.setWeeklyWindows(
          callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
          { resourceId: c.req.param('resourceId'), windows },
        )
        return c.json({ windows: rows.map(serializeWindow) })
      } catch (err) {
        return configErrorResponse(c, err)
      }
    },
  )

  app.post('/api/tenants/:tenantId/config/blocks', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      const body = await c.req.json<Record<string, unknown>>()
      if (
        typeof body.resourceId !== 'string'
        || typeof body.startsAt !== 'number'
        || typeof body.endsAt !== 'number'
        || typeof body.reason !== 'string'
      ) {
        return c.json({ error: 'invalid_body' }, 400)
      }
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const result = await gw.createBlock(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        {
          resourceId: body.resourceId,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          reason: body.reason as 'folga' | 'ferias' | 'feriado' | 'manutencao' | 'outro',
          note: typeof body.note === 'string' ? body.note : null,
          dryRun: body.dryRun === true,
        },
      )
      return c.json(serializeBlockResult(result), result.created ? 201 : 200)
    } catch (err) {
      return configErrorResponse(c, err)
    }
  })

  app.delete(
    '/api/tenants/:tenantId/config/blocks/:blockId',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        await gw.deleteBlock(
          callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
          c.req.param('blockId'),
        )
        return c.json({ ok: true })
      } catch (err) {
        return configErrorResponse(c, err)
      }
    },
  )

  /** DEC-075 / S5 — «Permitir os dois» no bloco da sala (só responsável). */
  app.post(
    '/api/tenants/:tenantId/config/rooms/:resourceId/allow-both-sexes',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const body = await c.req.json<Record<string, unknown>>()
        if (typeof body.startsAt !== 'number') {
          return c.json({ error: 'invalid_body' }, 400)
        }
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const row = await gw.allowBothSexesInBlock(
          callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
          {
            roomResourceId: c.req.param('resourceId'),
            startsAt: body.startsAt,
            ...(typeof body.endsAt === 'number' ? { endsAt: body.endsAt } : {}),
          },
        )
        return c.json(
          {
            id: row.id,
            roomResourceId: row.roomResourceId,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            actorClerkUserId: row.actorClerkUserId,
            createdAt: row.createdAt,
          },
          201,
        )
      } catch (err) {
        return configErrorResponse(c, err)
      }
    },
  )

  /**
   * Harness sintético: cria compromisso mínimo para testes de impacto de bloqueio.
   * Não é API de produto de agenda.
   */
  app.post('/api/tenants/:tenantId/config/test-appointments', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.config.write')
      if (c.env?.ENVIRONMENT === 'production') {
        return c.json({ error: 'not_available' }, 404)
      }
      const body = await c.req.json<Record<string, unknown>>()
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      if (!gw.insertAppointment) {
        return c.json({ error: 'not_supported' }, 501)
      }
      const row = await gw.insertAppointment(
        callerFromContext(ctx.tenantId, c.get('principal').clerkUserId),
        {
          serviceId: String(body.serviceId ?? ''),
          professionalId: String(body.professionalId ?? ''),
          roomResourceId:
            typeof body.roomResourceId === 'string' ? body.roomResourceId : null,
          startsAt: Number(body.startsAt),
          endsAt: Number(body.endsAt),
          contactLabel:
            typeof body.contactLabel === 'string' ? body.contactLabel : null,
        },
      )
      return c.json(row, 201)
    } catch (err) {
      return configErrorResponse(c, err)
    }
  })

  return app
}

function parseForecastPlaceBody(body: Record<string, unknown>) {
  if (body.mode === 'cidade') {
    if (typeof body.city !== 'string') {
      throw new ValidationError('invalid_forecast_place', 'Informe a cidade.')
    }
    return { mode: 'cidade' as const, city: body.city }
  }
  if (body.mode === 'coordenadas') {
    if (typeof body.latitude !== 'number' || typeof body.longitude !== 'number') {
      throw new ValidationError('invalid_forecast_place', 'Informe latitude e longitude.')
    }
    return {
      mode: 'coordenadas' as const,
      latitude: body.latitude,
      longitude: body.longitude,
    }
  }
  throw new ValidationError('invalid_forecast_place', 'Escolha cidade ou coordenadas.')
}

function parseAbuseLimitsBody(body: Record<string, unknown>): UpdateAbuseLimitsInput {
  const input: UpdateAbuseLimitsInput = {}
  if (typeof body.enabled === 'boolean') input.enabled = body.enabled
  if (typeof body.autoBookPaused === 'boolean') input.autoBookPaused = body.autoBookPaused
  if (body.resetToDefaults === true) input.resetToDefaults = true
  const num = (key: keyof UpdateAbuseLimitsInput) => {
    const v = body[key]
    if (v === undefined) return
    if (typeof v === 'number') (input as Record<string, unknown>)[key] = v
    else if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
      ;(input as Record<string, unknown>)[key] = Number(v.trim())
    }
  }
  num('windowHours')
  num('autoDraftsPerContact')
  num('aiBookingsPerContact')
  num('aiBookingsPerClinic')
  num('futureAppointmentsPerContact')
  num('pendingPixPerContact')
  num('pendingProposalsPerContact')
  num('proposalsPerContact')
  num('proposalsPerClinic')
  return input
}

function parseServiceBody(body: Record<string, unknown>) {
  const signalKind: 'fixed' | 'percent' | null | undefined =
    body.signalKind === 'fixed' || body.signalKind === 'percent'
      ? body.signalKind
      : body.signalKind === null
        ? null
        : undefined
  return {
    name: String(body.name ?? ''),
    durationMinutes: Number(body.durationMinutes),
    bufferMinutes: Number(body.bufferMinutes ?? 0),
    priceCents:
      body.priceCents === null || body.priceCents === undefined
        ? null
        : Number(body.priceCents),
    clientExplanation:
      body.clientExplanation === null || body.clientExplanation === undefined
        ? null
        : String(body.clientExplanation),
    active: body.active === false ? false : true,
    professionalIds: Array.isArray(body.professionalIds)
      ? body.professionalIds.map(String)
      : [],
    roomRequirement: body.roomRequirement as
      | undefined
      | { mode: 'none' }
      | { mode: 'any' }
      | { mode: 'category'; category: string }
      | { mode: 'resource'; resourceId: string },
    requiresSignal:
      body.requiresSignal === undefined ? undefined : body.requiresSignal === true,
    signalKind,
    signalFixedCents:
      body.signalFixedCents === null || body.signalFixedCents === undefined
        ? body.signalFixedCents === null
          ? null
          : undefined
        : Number(body.signalFixedCents),
    signalPercent:
      body.signalPercent === null || body.signalPercent === undefined
        ? body.signalPercent === null
          ? null
          : undefined
        : Number(body.signalPercent),
    durationAdjustable: body.durationAdjustable === true,
    durationMinMinutes:
      body.durationMinMinutes === null || body.durationMinMinutes === undefined
        ? null
        : Number(body.durationMinMinutes),
    durationMaxMinutes:
      body.durationMaxMinutes === null || body.durationMaxMinutes === undefined
        ? null
        : Number(body.durationMaxMinutes),
    ...(body.audiencia === undefined
      ? {}
      : { audiencia: body.audiencia as 'feminino' | 'masculino' | 'qualquer' }),
    ...parseTempoBody(body),
    ...(body.weeklyWindows === undefined
      ? {}
      : {
          weeklyWindows: parseWeeklyWindowsBody(body.weeklyWindows),
        }),
    ...(body.variantKind === undefined
      ? {}
      : { variantKind: body.variantKind === null ? null : String(body.variantKind) }),
  }
}

function parseTempoBody(body: Record<string, unknown>) {
  const present =
    body.tempoCeu !== undefined ||
    body.tempoTemperatura !== undefined ||
    body.tempoCelsius !== undefined
  if (!present) return {}
  if (Array.isArray(body.tempoTemperatura) || Array.isArray(body.tempoCeu)) {
    throw new ValidationError(
      'invalid_tempo',
      'Não dá para pedir acima e abaixo ao mesmo tempo.',
    )
  }
  return {
    ...(body.tempoCeu === undefined ? {} : { tempoCeu: body.tempoCeu as 'tanto_faz' | 'sol' | 'chuva' }),
    ...(body.tempoTemperatura === undefined
      ? {}
      : { tempoTemperatura: body.tempoTemperatura as 'tanto_faz' | 'acima' | 'abaixo' }),
    ...(body.tempoCelsius === undefined ? {} : { tempoCelsius: body.tempoCelsius as number | null }),
  }
}

function parseWeeklyWindowsBody(raw: unknown) {
  if (!Array.isArray(raw)) {
    throw new ValidationError('invalid_weekly_windows', 'weeklyWindows deve ser um array')
  }
  return raw.map((item) => {
    const w = item as Record<string, unknown>
    return {
      dayOfWeek: Number(w.dayOfWeek),
      startMinute: Number(w.startMinute),
      endMinute: Number(w.endMinute),
    }
  })
}

function parseResourceBody(body: Record<string, unknown>) {
  return {
    kind: String(body.kind ?? '') as 'professional' | 'room' | 'equipment',
    name: String(body.name ?? ''),
    category:
      body.category === null || body.category === undefined
        ? null
        : String(body.category),
    active: body.active === false ? false : true,
    ...(body.capacity === undefined ? {} : { capacity: Number(body.capacity) }),
    ...(body.sharedSpaceNotice === undefined
      ? {}
      : { sharedSpaceNotice: body.sharedSpaceNotice === null ? null : String(body.sharedSpaceNotice) }),
    ...(body.hoursMode === undefined ? {} : { hoursMode: String(body.hoursMode) as 'clinic' | 'own' }),
    ...(body.homeRoomId === undefined
      ? {}
      : { homeRoomId: body.homeRoomId === null ? null : String(body.homeRoomId) }),
    ...(body.attendanceMode === undefined
      ? {}
      : {
          attendanceMode: String(body.attendanceMode) as
            | 'cada_profissional'
            | 'uma_para_todas',
        }),
    ...(body.sameSexInSlot === undefined
      ? {}
      : { sameSexInSlot: Boolean(body.sameSexInSlot) }),
  }
}
