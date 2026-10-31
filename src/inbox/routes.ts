/**
 * Rotas da caixa de entrada partilhada (#29 / DEC-015/016; REQ-010/020/021).
 * Leituras e atribuição: owner + attendant (clinic.inbox.read / reply).
 * Sem Acompanhamento (#30) nem webhooks Meta (F3).
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
import type { InboxFilter } from '../clinic/constants'
import { INBOX_FILTERS } from '../clinic/constants'
import { getMembership } from '../db/admin/memberships'
import type { AdminDb } from '../db/admin/store'
import type { WorkerBindings } from '../worker/bindings'
import type { InboxGateway } from './gateway'
import type { ClinicOutboxQueueMessage } from '../whatsapp/queue-types'
import { processClinicOutboxMessage } from '../whatsapp/outbound-send'
import { createChannelLogger } from '../ops/log'
import {
  serializeContact,
  serializeConversation,
  serializeConversationDetail,
  serializeCounts,
  serializeMessage,
} from './serialize'
import {
  resolveHumanOutboundDisplayName,
  SYNTH_STAFF_FIRST_NAMES,
} from '../clinic/inbox/human-prefix'
import { resolveAuthMode } from '../auth/deps'
import { createClerkClientFromConfig } from '../auth/clerk-backend'

type InboxEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type InboxRouteOptions = {
  gatewayFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => InboxGateway | Promise<InboxGateway>
  syncAdminDbFactory?: (env: WorkerBindings) => AdminDb | null
  /** Testes: substitui o envio inline (Meta + DO). */
  inlineSend?: (env: WorkerBindings, dispatch: ClinicOutboxQueueMessage) => Promise<void>
}

function inboxErrorResponse(
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
    { error: err instanceof Error ? err.message : 'inbox_error' },
    400,
  )
}

/**
 * Envio imediato à Meta (fora do caminho da resposta, via waitUntil).
 * Falha → a mensagem de fila atrasada (fallback) envia; claim no DO evita duplo envio.
 */
function scheduleInlineSend(
  c: { env: WorkerBindings; executionCtx: { waitUntil(p: Promise<unknown>): void } },
  tenantId: string,
  dispatch: ClinicOutboxQueueMessage,
  opts: InboxRouteOptions,
): void {
  const run = (opts.inlineSend ?? defaultInlineSend)(c.env, dispatch).catch((err) => {
    inlineLog({
      level: 'warn',
      event: 'whatsapp_send.inline_failed',
      detail: {
        tenantId,
        eventId: dispatch.eventId,
        errorCode: (err instanceof Error ? err.message : 'inline_failed').slice(0, 80),
      },
    })
  })
  let ctx: { waitUntil(p: Promise<unknown>): void } | null = null
  try {
    ctx = c.executionCtx
  } catch {
    ctx = null
  }
  if (ctx) ctx.waitUntil(run)
  else void run
}

const inlineLog = createChannelLogger('whatsapp_send')

async function defaultInlineSend(
  env: WorkerBindings,
  dispatch: ClinicOutboxQueueMessage,
): Promise<void> {
  await processClinicOutboxMessage(dispatch, { env, mode: 'inline', log: inlineLog })
}

function createDoGateway(env: WorkerBindings, tenantId: string): InboxGateway {
  const stub = env.CLINIC.get(env.CLINIC.idFromName(tenantId))
  return {
    listConversations: (caller, input) => stub.listInboxConversations(caller, input),
    getConversation: (caller, input) => stub.getInboxConversation(caller, input),
    listContacts: (caller, input) => stub.listInboxContacts(caller, input),
    getContact: (caller, contactId) => stub.getInboxContact(caller, contactId),
    assign: (caller, input) => stub.assignInboxConversation(caller, input),
    resumeAiReply: (caller, conversationId) => stub.resumeInboxAiReply(caller, conversationId),
    markRead: (caller, input) => stub.markInboxConversationRead(caller, input),
    close: (caller, input) => stub.closeInboxConversation(caller, input),
    blockContact: (caller, input) => stub.blockInboxContact(caller, input),
    unblockContact: (caller, input) => stub.unblockInboxContact(caller, input),
    sendOutbound: (caller, input) => stub.sendInboxOutbound(caller, input),
    seedDemo: (caller, opts) => stub.seedInboxDemo(caller, opts),
  }
}

async function resolveGateway(
  env: WorkerBindings,
  tenantId: string,
  opts: InboxRouteOptions,
): Promise<InboxGateway> {
  if (opts.gatewayFactory) return opts.gatewayFactory(env, tenantId)
  return createDoGateway(env, tenantId)
}

function parseFilter(raw: string | undefined): InboxFilter {
  if (!raw || raw === 'all') return 'all'
  if ((INBOX_FILTERS as readonly string[]).includes(raw)) return raw as InboxFilter
  throw new ValidationError('invalid_filter', `Filtro inválido: ${raw}`)
}

/** Papel para textos internos do painel (atribuir / encerrar) — não usar no WhatsApp. */
function displayNameFromAuth(_clerkUserId: string, role: string): string {
  if (role === 'owner') return 'Responsável'
  return 'Atendente'
}

/**
 * DEC-088: nome da pessoa no outbound WhatsApp.
 * Preferência: body.authorDisplayName → Clerk firstName → persona sintética → «Equipe».
 * Nunca o rótulo do papel (Responsável / Atendente).
 */
async function resolveOutboundAuthorDisplayName(
  env: WorkerBindings,
  clerkUserId: string,
  bodyDisplayName?: string | null,
): Promise<string> {
  const fromBody = (bodyDisplayName ?? '').trim() || null

  let fromClerk: string | null = null
  try {
    if (resolveAuthMode(env) === 'clerk' && env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY) {
      const client = createClerkClientFromConfig({
        secretKey: env.CLERK_SECRET_KEY,
        publishableKey: env.CLERK_PUBLISHABLE_KEY,
        jwtKey: env.CLERK_JWT_KEY,
        authorizedParties: [],
      })
      const user = await client.users.getUser(clerkUserId)
      fromClerk =
        user.firstName?.trim() ||
        user.fullName?.trim() ||
        user.username?.trim() ||
        null
    }
  } catch {
    fromClerk = null
  }

  const fromSynth = SYNTH_STAFF_FIRST_NAMES[clerkUserId] ?? null
  return resolveHumanOutboundDisplayName(fromBody, fromClerk, fromSynth)
}

export function createInboxRoutes(opts: InboxRouteOptions = {}) {
  const app = new Hono<InboxEnv>()

  const tenant = [
    requireAuth(),
    requireTenantAccess({ param: 'tenantId' }),
  ] as const

  app.get('/api/tenants/:tenantId/inbox/conversations', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      const principal = c.get('principal')
      requireClinicPermission(ctx, 'clinic.inbox.read')
      const tenantId = c.req.param('tenantId')
      const gw = await resolveGateway(c.env, tenantId, opts)
      const filter = parseFilter(c.req.query('filter') ?? undefined)
      const q = c.req.query('q') ?? undefined
      const beforeRaw = c.req.query('before')
      const before = beforeRaw ? Number(beforeRaw) : null
      if (beforeRaw && !Number.isFinite(before)) {
        throw new ValidationError('invalid_before', 'before deve ser epoch ms')
      }
      const limitRaw = c.req.query('limit')
      const limit = limitRaw ? Number(limitRaw) : undefined
      const result = await gw.listConversations(
        workerCaller(tenantId, principal.clerkUserId),
        {
          filter,
          q,
          before,
          limit,
          viewerClerkUserId: principal.clerkUserId,
        },
      )
      return c.json({
        conversations: result.items.map(serializeConversation),
        nextBefore: result.nextBefore,
        counts: serializeCounts(result.counts),
      })
    } catch (err) {
      return inboxErrorResponse(c, err)
    }
  })

  app.get(
    '/api/tenants/:tenantId/inbox/conversations/:conversationId',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.inbox.read')
        const tenantId = c.req.param('tenantId')
        const conversationId = c.req.param('conversationId')
        const gw = await resolveGateway(c.env, tenantId, opts)
        const beforeRaw = c.req.query('before')
        const before = beforeRaw ? Number(beforeRaw) : null
        const limitRaw = c.req.query('messageLimit')
        const messageLimit = limitRaw ? Number(limitRaw) : undefined
        const detail = await gw.getConversation(
          workerCaller(tenantId, principal.clerkUserId),
          {
            conversationId,
            before,
            messageLimit,
          },
        )
        return c.json(serializeConversationDetail(detail))
      } catch (err) {
        return inboxErrorResponse(c, err)
      }
    },
  )

  app.get('/api/tenants/:tenantId/inbox/contacts', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      const principal = c.get('principal')
      requireClinicPermission(ctx, 'clinic.inbox.read')
      const tenantId = c.req.param('tenantId')
      const gw = await resolveGateway(c.env, tenantId, opts)
      const filterRaw = c.req.query('filter') ?? 'all'
      if (
        filterRaw !== 'all' &&
        filterRaw !== 'blocked' &&
        filterRaw !== 'with_appointment'
      ) {
        throw new ValidationError('invalid_filter', `Filtro inválido: ${filterRaw}`)
      }
      const limitRaw = c.req.query('limit')
      const limit = limitRaw ? Number(limitRaw) : undefined
      const result = await gw.listContacts(workerCaller(tenantId, principal.clerkUserId), {
        q: c.req.query('q') ?? null,
        filter: filterRaw,
        limit: Number.isFinite(limit) ? limit : undefined,
      })
      return c.json({
        contacts: result.contacts.map(serializeContact),
        nextBefore: result.nextBefore,
      })
    } catch (err) {
      return inboxErrorResponse(c, err)
    }
  })

  app.get('/api/tenants/:tenantId/inbox/contacts/:contactId', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      const principal = c.get('principal')
      requireClinicPermission(ctx, 'clinic.inbox.read')
      const tenantId = c.req.param('tenantId')
      const contactId = c.req.param('contactId')
      const gw = await resolveGateway(c.env, tenantId, opts)
      const result = await gw.getContact(
        workerCaller(tenantId, principal.clerkUserId),
        contactId,
      )
      return c.json({
        contact: serializeContact(result.contact),
        conversations: result.conversations.map(serializeConversation),
        hasPendingPix: result.hasPendingPix,
        appointments: {
          upcoming: result.appointments.upcoming,
          past: result.appointments.past,
        },
      })
    } catch (err) {
      return inboxErrorResponse(c, err)
    }
  })

  app.post(
    '/api/tenants/:tenantId/inbox/conversations/:conversationId/assign',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.inbox.reply')
        const tenantId = c.req.param('tenantId')
        const conversationId = c.req.param('conversationId')
        const body = (await c.req.json()) as {
          assigneeClerkUserId?: string | null
          assigneeDisplayName?: string | null
          expectedAssignmentVersion?: number | null
        }

        const assigneeClerkUserId =
          body.assigneeClerkUserId === undefined
            ? principal.clerkUserId
            : body.assigneeClerkUserId
        let assigneeDisplayName =
          body.assigneeDisplayName ??
          (assigneeClerkUserId === principal.clerkUserId
            ? displayNameFromAuth(principal.clerkUserId, ctx.role)
            : null)

        if (assigneeClerkUserId) {
          const adminDb = opts.syncAdminDbFactory?.(c.env) ?? null
          if (adminDb) {
            const membership = getMembership(adminDb, tenantId, assigneeClerkUserId)
            if (!membership || membership.status !== 'active') {
              throw new ValidationError(
                'assignee_not_member',
                'Responsável tem de ser membership ativa desta clínica',
              )
            }
            if (!assigneeDisplayName) {
              assigneeDisplayName =
                membership.role === 'owner' ? 'Responsável' : 'Atendente'
            }
          }
        }

        const gw = await resolveGateway(c.env, tenantId, opts)
        const result = await gw.assign(workerCaller(tenantId, principal.clerkUserId), {
          conversationId,
          assigneeClerkUserId,
          assigneeDisplayName,
          actorClerkUserId: principal.clerkUserId,
          actorDisplayName: displayNameFromAuth(principal.clerkUserId, ctx.role),
          expectedAssignmentVersion: body.expectedAssignmentVersion ?? null,
        })

        const status = result.versionMatched ? 200 : 409
        return c.json(
          {
            conversation: serializeConversation(result.conversation),
            systemMessage: serializeMessage(result.systemMessage),
            versionMatched: result.versionMatched,
          },
          status,
        )
      } catch (err) {
        return inboxErrorResponse(c, err)
      }
    },
  )

  app.post(
    '/api/tenants/:tenantId/inbox/conversations/:conversationId/resume-ai',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.inbox.reply')
        const tenantId = c.req.param('tenantId')
        const conversationId = c.req.param('conversationId')
        const gw = await resolveGateway(c.env, tenantId, opts)
        const result = await gw.resumeAiReply(
          workerCaller(tenantId, principal.clerkUserId),
          conversationId,
        )
        return c.json(result)
      } catch (err) {
        return inboxErrorResponse(c, err)
      }
    },
  )

  app.post(
    '/api/tenants/:tenantId/inbox/conversations/:conversationId/read',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.inbox.read')
        const tenantId = c.req.param('tenantId')
        const conversationId = c.req.param('conversationId')
        const gw = await resolveGateway(c.env, tenantId, opts)
        const conversation = await gw.markRead(
          workerCaller(tenantId, principal.clerkUserId),
          {
            conversationId,
            readerClerkUserId: principal.clerkUserId,
            readerDisplayName: displayNameFromAuth(principal.clerkUserId, ctx.role),
          },
        )
        return c.json({ conversation: serializeConversation(conversation) })
      } catch (err) {
        return inboxErrorResponse(c, err)
      }
    },
  )

  app.post(
    '/api/tenants/:tenantId/inbox/conversations/:conversationId/close',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.inbox.reply')
        const tenantId = c.req.param('tenantId')
        const conversationId = c.req.param('conversationId')
        const gw = await resolveGateway(c.env, tenantId, opts)
        const result = await gw.close(workerCaller(tenantId, principal.clerkUserId), {
          conversationId,
          actorClerkUserId: principal.clerkUserId,
          actorDisplayName: displayNameFromAuth(principal.clerkUserId, ctx.role),
        })
        return c.json({
          conversation: serializeConversation(result.conversation),
          systemMessage: serializeMessage(result.systemMessage),
        })
      } catch (err) {
        return inboxErrorResponse(c, err)
      }
    },
  )

  app.post(
    '/api/tenants/:tenantId/inbox/contacts/:contactId/block',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.inbox.reply')
        const tenantId = c.req.param('tenantId')
        const contactId = c.req.param('contactId')
        const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown }
        const reason = typeof body.reason === 'string' ? body.reason : null
        const gw = await resolveGateway(c.env, tenantId, opts)
        const result = await gw.blockContact(workerCaller(tenantId, principal.clerkUserId), {
          contactId,
          actorClerkUserId: principal.clerkUserId,
          actorDisplayName: displayNameFromAuth(principal.clerkUserId, ctx.role),
          reason,
        })
        return c.json({
          contact: serializeContact(result.contact),
          closedConversationIds: result.closedConversationIds,
        })
      } catch (err) {
        return inboxErrorResponse(c, err)
      }
    },
  )

  app.post(
    '/api/tenants/:tenantId/inbox/contacts/:contactId/unblock',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.inbox.reply')
        const tenantId = c.req.param('tenantId')
        const contactId = c.req.param('contactId')
        const gw = await resolveGateway(c.env, tenantId, opts)
        const result = await gw.unblockContact(workerCaller(tenantId, principal.clerkUserId), {
          contactId,
          actorClerkUserId: principal.clerkUserId,
          actorDisplayName: displayNameFromAuth(principal.clerkUserId, ctx.role),
        })
        return c.json({ contact: serializeContact(result.contact) })
      } catch (err) {
        return inboxErrorResponse(c, err)
      }
    },
  )

  app.post(
    '/api/tenants/:tenantId/inbox/conversations/:conversationId/messages',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        const principal = c.get('principal')
        requireClinicPermission(ctx, 'clinic.inbox.reply')
        const tenantId = c.req.param('tenantId')
        const conversationId = c.req.param('conversationId')
        const body = (await c.req.json()) as {
          body?: string
          clientRequestId?: string
          aiSuggestionId?: string | null
          /** Nome de apresentação (Clerk / membership) — nunca o papel. */
          authorDisplayName?: string | null
          template?: {
            name?: string
            language?: string
            params?: Record<string, string>
          }
        }
        if (!body.clientRequestId) {
          throw new ValidationError(
            'invalid_message',
            'clientRequestId é obrigatório',
          )
        }
        const hasTemplate = Boolean(body.template?.name?.trim())
        if (!hasTemplate && !body.body?.trim()) {
          throw new ValidationError(
            'invalid_message',
            'body ou template são obrigatórios',
          )
        }
        const authorDisplayName = await resolveOutboundAuthorDisplayName(
          c.env,
          principal.clerkUserId,
          body.authorDisplayName,
        )
        const gw = await resolveGateway(c.env, tenantId, opts)
        const result = await gw.sendOutbound(
          workerCaller(tenantId, principal.clerkUserId),
          {
            conversationId,
            body: body.body ?? null,
            template: hasTemplate
              ? {
                  name: body.template!.name!.trim(),
                  language: (body.template!.language ?? 'pt_BR').trim(),
                  params: body.template!.params ?? {},
                }
              : null,
            clientRequestId: body.clientRequestId,
            authorClerkUserId: principal.clerkUserId,
            authorDisplayName,
            aiSuggestionId: body.aiSuggestionId ?? null,
          },
        )
        if (result.inlineDispatch) {
          scheduleInlineSend(c, tenantId, result.inlineDispatch, opts)
        }
        return c.json(
          {
            conversation: serializeConversation(result.conversation),
            message: serializeMessage(result.message),
            duplicate: result.duplicate,
            outbound: result.outbound
              ? {
                  id: result.outbound.id,
                  clientRequestId: result.outbound.clientRequestId,
                  deliveryState: result.outbound.deliveryState,
                  kind: result.outbound.kind,
                  providerMessageId: result.outbound.providerMessageId,
                }
              : null,
          },
          result.duplicate ? 200 : 201,
        )
      } catch (err) {
        return inboxErrorResponse(c, err)
      }
    },
  )

  /** Seeds sintéticos para demonstração antes de Meta (F3). */
  app.post('/api/tenants/:tenantId/inbox/seed-demo', ...tenant, async (c) => {
    try {
      const ctx = c.get('tenantContext')!
      const principal = c.get('principal')
      requireClinicPermission(ctx, 'clinic.inbox.reply')
      const tenantId = c.req.param('tenantId')
      const body = (await c.req.json().catch(() => ({}))) as { force?: boolean }
      const gw = await resolveGateway(c.env, tenantId, opts)
      const result = await gw.seedDemo(workerCaller(tenantId, principal.clerkUserId), {
        force: body.force === true,
      })
      return c.json(result)
    } catch (err) {
      return inboxErrorResponse(c, err)
    }
  })

  return app
}
