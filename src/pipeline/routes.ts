/**
 * Rotas do Acompanhamento (#30 / REQ-023; DEC-040/045).
 * Leitura: owner + attendant (clinic.inbox.read).
 * Mover: clinic.pipeline.move.
 * Sem editor livre de etapas, sem automações, sem agenda completa (#35/#36).
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
import {
  OPPORTUNITY_STAGES,
  type OpportunityStage,
} from '../clinic/constants'
import type { WorkerBindings } from '../worker/bindings'
import type { PipelineGateway } from './gateway'
import {
  serializeOpportunity,
  serializeOpportunityDetail,
  serializeStageCounts,
} from './serialize'

type PipelineEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type PipelineRouteOptions = {
  gatewayFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => PipelineGateway | Promise<PipelineGateway>
}

function pipelineErrorResponse(
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
  return c.json(
    { error: err instanceof Error ? err.message : 'pipeline_error' },
    400,
  )
}

function createDoGateway(env: WorkerBindings, tenantId: string): PipelineGateway {
  const stub = env.CLINIC.get(env.CLINIC.idFromName(tenantId))
  return {
    list: (caller, input) => stub.listPipelineOpportunities(caller, input),
    get: (caller, id) => stub.getPipelineOpportunity(caller, id),
    move: (caller, input) => stub.movePipelineStage(caller, input),
    linkAppointment: (caller, input) =>
      stub.linkPipelineAppointment(caller, input),
    reopen: (caller, input) => stub.reopenPipelineOpportunity(caller, input),
    seedDemo: (caller, opts) => stub.seedPipelineDemo(caller, opts),
  }
}

async function resolveGateway(
  env: WorkerBindings,
  tenantId: string,
  opts: PipelineRouteOptions,
): Promise<PipelineGateway> {
  if (opts.gatewayFactory) return opts.gatewayFactory(env, tenantId)
  return createDoGateway(env, tenantId)
}

function parseStage(raw: string | undefined): OpportunityStage | null {
  if (!raw) return null
  if ((OPPORTUNITY_STAGES as readonly string[]).includes(raw)) {
    return raw as OpportunityStage
  }
  throw new ValidationError('invalid_stage', `Etapa inválida: ${raw}`)
}

function displayNameFromAuth(role: string): string {
  if (role === 'owner') return 'Responsável'
  return 'Atendente'
}

export function createPipelineRoutes(opts: PipelineRouteOptions = {}) {
  const app = new Hono<PipelineEnv>()

  const tenant = [
    requireAuth(),
    requireTenantAccess({ param: 'tenantId' }),
  ] as const

  app.get('/api/tenants/:tenantId/pipeline/opportunities', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.inbox.read')
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const stage = parseStage(c.req.query('stage') ?? undefined)
      const includeClosed = c.req.query('includeClosed') === '1'
      const limitRaw = c.req.query('limit')
      const limit = limitRaw ? Number(limitRaw) : undefined
      const result = await gw.list(workerCaller(ctx.tenantId, c.get('principal').clerkUserId), {
        stage,
        includeClosed,
        limit: Number.isFinite(limit) ? limit : undefined,
      })
      return c.json({
        opportunities: result.items.map((o) => serializeOpportunity(o)),
        counts: serializeStageCounts(result.counts),
      })
    } catch (err) {
      return pipelineErrorResponse(c, err)
    }
  })

  app.get(
    '/api/tenants/:tenantId/pipeline/opportunities/:opportunityId',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.inbox.read')
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const detail = await gw.get(
          workerCaller(ctx.tenantId, c.get('principal').clerkUserId),
          c.req.param('opportunityId'),
        )
        return c.json({ opportunity: serializeOpportunityDetail(detail) })
      } catch (err) {
        return pipelineErrorResponse(c, err)
      }
    },
  )

  app.post(
    '/api/tenants/:tenantId/pipeline/opportunities/:opportunityId/move',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.pipeline.move')
        const principal = c.get('principal')
        const body = (await c.req.json().catch(() => ({}))) as {
          toStage?: string
          expectedUpdatedAt?: number | null
          note?: string | null
        }
        const toStage = parseStage(body.toStage)
        if (!toStage) {
          throw new ValidationError('invalid_stage', 'toStage é obrigatório')
        }
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const detail = await gw.move(
          workerCaller(ctx.tenantId, principal.clerkUserId),
          {
            opportunityId: c.req.param('opportunityId'),
            toStage,
            actorClerkUserId: principal.clerkUserId,
            actorDisplayName: displayNameFromAuth(ctx.role),
            expectedUpdatedAt: body.expectedUpdatedAt ?? null,
            note: body.note ?? null,
          },
        )
        return c.json({ opportunity: serializeOpportunityDetail(detail) })
      } catch (err) {
        return pipelineErrorResponse(c, err)
      }
    },
  )

  app.post(
    '/api/tenants/:tenantId/pipeline/opportunities/:opportunityId/link-appointment',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.pipeline.move')
        const principal = c.get('principal')
        const body = (await c.req.json().catch(() => ({}))) as {
          appointmentId?: string
        }
        if (!body.appointmentId?.trim()) {
          throw new ValidationError('appointment_required', 'appointmentId é obrigatório')
        }
        const gw = await resolveGateway(c.env, ctx.tenantId, opts)
        const detail = await gw.linkAppointment(
          workerCaller(ctx.tenantId, principal.clerkUserId),
          {
            opportunityId: c.req.param('opportunityId'),
            appointmentId: body.appointmentId.trim(),
            actorClerkUserId: principal.clerkUserId,
            actorDisplayName: displayNameFromAuth(ctx.role),
          },
        )
        return c.json({ opportunity: serializeOpportunityDetail(detail) })
      } catch (err) {
        return pipelineErrorResponse(c, err)
      }
    },
  )

  app.post('/api/tenants/:tenantId/pipeline/reopen', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.pipeline.move')
      const principal = c.get('principal')
      const body = (await c.req.json().catch(() => ({}))) as {
        conversationId?: string
        initialStage?: string
      }
      if (!body.conversationId?.trim()) {
        throw new ValidationError('conversation_required', 'conversationId é obrigatório')
      }
      const initialStage = body.initialStage
        ? parseStage(body.initialStage) ?? undefined
        : undefined
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const detail = await gw.reopen(
        workerCaller(ctx.tenantId, principal.clerkUserId),
        {
          conversationId: body.conversationId.trim(),
          actorClerkUserId: principal.clerkUserId,
          actorDisplayName: displayNameFromAuth(ctx.role),
          initialStage: initialStage ?? undefined,
        },
      )
      return c.json({ opportunity: serializeOpportunityDetail(detail) })
    } catch (err) {
      return pipelineErrorResponse(c, err)
    }
  })

  app.post('/api/tenants/:tenantId/pipeline/seed-demo', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      requireClinicPermission(ctx, 'clinic.inbox.read')
      const body = (await c.req.json().catch(() => ({}))) as { force?: boolean }
      const gw = await resolveGateway(c.env, ctx.tenantId, opts)
      const result = await gw.seedDemo(
        workerCaller(ctx.tenantId, c.get('principal').clerkUserId),
        { force: body.force === true },
      )
      return c.json(result)
    } catch (err) {
      return pipelineErrorResponse(c, err)
    }
  })

  return app
}
