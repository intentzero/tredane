/**
 * Rotas IA assistiva (#41 / DEC-011/040/046; REQ-022/072–075).
 * Só sob demanda explícita; nunca envia WhatsApp.
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
import { resolveAiMode } from '../ai'
import { rpcDepsFromEnv, type AiAssistRpcDeps } from '../clinic/ai'
import type { WorkerBindings } from '../worker/bindings'
import type { AiAssistGateway } from './gateway'
import { serializeAiSuggestion } from './serialize'

type AiEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type AiAssistRouteOptions = {
  gatewayFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => AiAssistGateway | Promise<AiAssistGateway>
  rpcDepsFactory?: (env: WorkerBindings) => AiAssistRpcDeps
}

function aiErrorResponse(
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
      err.code === 'tenant_mismatch'
      || err.code === 'unauthorized_caller'
      || err.code === 'ai_not_enabled'
        ? 403
        : err.code === 'ai_daily_cap_reached'
          ? 429
          : 400
    return c.json({ error: err.code, message: err.message }, status)
  }
  return c.json(
    { error: err instanceof Error ? err.message : 'ai_error' },
    400,
  )
}

function createDoGateway(env: WorkerBindings, tenantId: string): AiAssistGateway {
  const stub = env.CLINIC.get(env.CLINIC.idFromName(tenantId))
  return {
    suggestReply: (caller, input, deps) => stub.suggestAiReply(caller, input, deps),
    summarize: (caller, input, deps) => stub.summarizeAiConversation(caller, input, deps),
    decide: (caller, input) => stub.decideAiSuggestion(caller, input),
    list: (caller, conversationId, opts) =>
      stub.listAiSuggestions(caller, conversationId, opts),
    get: (caller, suggestionId) => stub.getAiSuggestion(caller, suggestionId),
    draftState: (caller, conversationId) => stub.getAiDraftState(caller, conversationId),
    status: (caller) => stub.getAiStatus(caller),
  }
}

export function defaultAiRpcDeps(env: WorkerBindings): AiAssistRpcDeps {
  return rpcDepsFromEnv(env)
}

async function resolveGateway(
  env: WorkerBindings,
  tenantId: string,
  opts: AiAssistRouteOptions,
): Promise<AiAssistGateway> {
  if (opts.gatewayFactory) return opts.gatewayFactory(env, tenantId)
  return createDoGateway(env, tenantId)
}

export function createAiAssistRoutes(opts: AiAssistRouteOptions = {}) {
  const app = new Hono<AiEnv>()
  const tenant = [
    requireAuth(),
    requireTenantAccess({ param: 'tenantId' }),
  ] as const

  const depsOf = (env: WorkerBindings) =>
    opts.rpcDepsFactory ? opts.rpcDepsFactory(env) : defaultAiRpcDeps(env)

  app.post(
    '/api/tenants/:tenantId/conversations/:conversationId/ai/suggest',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.inbox.reply')
        const tenantId = c.req.param('tenantId')
        const conversationId = c.req.param('conversationId')
        const body = (await c.req.json().catch(() => ({}))) as {
          clientRequestId?: string
          parentSuggestionId?: string | null
          actorDisplayName?: string
        }
        if (!body.clientRequestId?.trim()) {
          throw new ValidationError('client_request_id_required', 'clientRequestId obrigatório')
        }
        const rpcDeps = depsOf(c.env)
        const gw = await resolveGateway(c.env, tenantId, opts)
        const result = await gw.suggestReply(
          workerCaller(tenantId, principal.clerkUserId),
          {
            conversationId,
            clientRequestId: body.clientRequestId.trim(),
            actorClerkUserId: principal.clerkUserId,
            actorDisplayName: body.actorDisplayName?.trim() || 'Atendente',
            parentSuggestionId: body.parentSuggestionId ?? null,
          },
          rpcDeps,
        )
        return c.json({
          suggestion: serializeAiSuggestion(result.suggestion),
          duplicate: result.duplicate,
          messageSent: false,
          contextDebug:
            result.contextInspection && resolveAiMode(c.env.AI_MODE) === 'synthetic'
              ? {
                  messageCount: result.contextInspection.payload.messages.length,
                  hasWaIdInPayload: false,
                  excludedWaIdPresent: result.contextInspection._debugExcluded.waIdPresent,
                  excludedAttachmentCount:
                    result.contextInspection._debugExcluded.attachmentCount,
                  firstName: result.contextInspection.payload.contactFirstName,
                  stage: result.contextInspection.payload.stage,
                  serviceNames: result.contextInspection.payload.services.map((s) => s.name),
                }
              : undefined,
        })
      } catch (err) {
        return aiErrorResponse(c, err)
      }
    },
  )

  /** Rascunho automático: estado do job + sugestão pendente + limite/fallback. */
  app.get(
    '/api/tenants/:tenantId/conversations/:conversationId/ai/draft',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.inbox.read')
        const tenantId = c.req.param('tenantId')
        const gw = await resolveGateway(c.env, tenantId, opts)
        if (!gw.draftState) return c.json({ job: null, suggestion: null })
        const st = await gw.draftState(
          workerCaller(tenantId, principal.clerkUserId),
          c.req.param('conversationId'),
        )
        return c.json({
          job: st.job ? { state: st.job.state, messageId: st.job.messageId, dueAt: st.job.dueAt } : null,
          suggestion: st.suggestion ? serializeAiSuggestion(st.suggestion) : null,
          usage: st.usage,
          syntheticFallback: st.syntheticFallback,
          mode: st.mode,
          messageSent: false,
        })
      } catch (err) {
        return aiErrorResponse(c, err)
      }
    },
  )

  /** Estado da IA na clínica (aviso de fallback sintético e limite diário). */
  app.get('/api/tenants/:tenantId/ai/status', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      const principal = c.get('principal')
      requireClinicPermission(ctx, 'clinic.inbox.read')
      const tenantId = c.req.param('tenantId')
      const gw = await resolveGateway(c.env, tenantId, opts)
      if (!gw.status) return c.json({ mode: 'unknown', syntheticFallback: false, usage: null })
      const st = await gw.status(workerCaller(tenantId, principal.clerkUserId))
      return c.json(st)
    } catch (err) {
      return aiErrorResponse(c, err)
    }
  })

  app.post(
    '/api/tenants/:tenantId/conversations/:conversationId/ai/summarize',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.inbox.read')
        const tenantId = c.req.param('tenantId')
        const conversationId = c.req.param('conversationId')
        const body = (await c.req.json().catch(() => ({}))) as {
          clientRequestId?: string
          actorDisplayName?: string
        }
        if (!body.clientRequestId?.trim()) {
          throw new ValidationError('client_request_id_required', 'clientRequestId obrigatório')
        }
        const gw = await resolveGateway(c.env, tenantId, opts)
        const result = await gw.summarize(
          workerCaller(tenantId, principal.clerkUserId),
          {
            conversationId,
            clientRequestId: body.clientRequestId.trim(),
            actorClerkUserId: principal.clerkUserId,
            actorDisplayName: body.actorDisplayName?.trim() || 'Atendente',
          },
          depsOf(c.env),
        )
        return c.json({
          suggestion: serializeAiSuggestion(result.suggestion),
          duplicate: result.duplicate,
          messageSent: false,
        })
      } catch (err) {
        return aiErrorResponse(c, err)
      }
    },
  )

  app.post(
    '/api/tenants/:tenantId/ai/suggestions/:suggestionId/decide',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.inbox.reply')
        const tenantId = c.req.param('tenantId')
        const suggestionId = c.req.param('suggestionId')
        const body = (await c.req.json().catch(() => ({}))) as {
          clientRequestId?: string
          decision?: string
          revisedText?: string | null
          outboundMessageId?: string | null
          actorDisplayName?: string
        }
        if (!body.clientRequestId?.trim()) {
          throw new ValidationError('client_request_id_required', 'clientRequestId obrigatório')
        }
        if (
          body.decision !== 'use' &&
          body.decision !== 'edit' &&
          body.decision !== 'discard'
        ) {
          throw new ValidationError('invalid_decision', 'Decisão inválida')
        }
        const gw = await resolveGateway(c.env, tenantId, opts)
        const result = await gw.decide(workerCaller(tenantId, principal.clerkUserId), {
          suggestionId,
          clientRequestId: body.clientRequestId.trim(),
          decision: body.decision,
          actorClerkUserId: principal.clerkUserId,
          actorDisplayName: body.actorDisplayName?.trim() || 'Atendente',
          revisedText: body.revisedText ?? null,
          outboundMessageId: body.outboundMessageId ?? null,
        })
        return c.json({
          suggestion: serializeAiSuggestion(result.suggestion),
          duplicate: result.duplicate,
          messageSent: false,
        })
      } catch (err) {
        return aiErrorResponse(c, err)
      }
    },
  )

  app.get(
    '/api/tenants/:tenantId/conversations/:conversationId/ai/suggestions',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.inbox.read')
        const tenantId = c.req.param('tenantId')
        const conversationId = c.req.param('conversationId')
        const kind = c.req.query('kind')
        const gw = await resolveGateway(c.env, tenantId, opts)
        const items = await gw.list(
          workerCaller(tenantId, principal.clerkUserId),
          conversationId,
          {
            kind: kind === 'reply' || kind === 'summary' ? kind : undefined,
          },
        )
        return c.json({ suggestions: items.map(serializeAiSuggestion) })
      } catch (err) {
        return aiErrorResponse(c, err)
      }
    },
  )

  return app
}
