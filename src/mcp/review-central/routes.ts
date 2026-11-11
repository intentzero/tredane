/**
 * MCP cross-tenant de amostras de revisão (DEC-159) — Streamable HTTP JSON-RPC.
 * Auth: OAuth MCP (primary, OAUTH_KV) ou Bearer Clerk session de superadmin (fallback).
 */
import { Hono } from 'hono'
import { authenticateHumanWithOptionalSuperadmin } from '../../auth/authorize'
import { isAuthError } from '../../auth/errors'
import {
  createAuthServicesMiddleware,
  type AuthDepsFactory,
  type AuthEnv,
} from '../../auth/middleware'
import type { AdminDb } from '../../db/admin/store'
import type { WorkerBindings } from '../../worker/bindings'
import { systemClock } from '../../db/clock'
import {
  fetchOAuthAuthorizationServerMeta,
  handleReviewMcpAuthorize,
  handleReviewMcpOAuthPassthrough,
  oauthKvConfigured,
  resourceMetadataBody,
  tryValidateReviewMcpOAuthToken,
  unauthorizedMcpResponse,
  type ReviewMcpOAuthProps,
} from './oauth'
import {
  isJsonRpcRequest,
  jsonRpcError,
  jsonRpcSuccess,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  type JsonRpcId,
  type JsonRpcRequest,
} from './protocol'
import {
  REVIEW_CENTRAL_MCP_TOOLS,
  callReviewCentralMcpTool,
  createD1ReviewCentralStore,
  createSyncReviewCentralStore,
  type ReviewCentralStore,
} from './tools'

type McpEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type ReviewCentralMcpRouteOptions = {
  authServicesFactory: AuthDepsFactory
  /** Store injectável (testes). */
  storeFactory?: (env: WorkerBindings) => ReviewCentralStore
  /** AdminDb sync para testes sem D1. */
  syncAdminDbFactory?: (env: WorkerBindings) => AdminDb | null
  clockFactory?: () => { nowMs: () => number }
}

const JSON_RPC_UNAUTHENTICATED = -32001

function requestId(msg: JsonRpcRequest): JsonRpcId {
  return msg.id === undefined ? null : msg.id
}

function authErrorResponse(id: JsonRpcId, err: unknown): Response {
  if (isAuthError(err)) {
    return Response.json(
      jsonRpcError(id, JSON_RPC_UNAUTHENTICATED, err.message || err.code, {
        error: err.code,
        status: err.status,
      }),
      { status: err.status },
    )
  }
  return Response.json(
    jsonRpcError(id, JSON_RPC_UNAUTHENTICATED, 'authority_verification_failed', {
      error: 'authority_verification_failed',
      status: 403,
    }),
    { status: 403 },
  )
}

function resolveStore(
  env: WorkerBindings,
  opts: ReviewCentralMcpRouteOptions,
): ReviewCentralStore {
  if (opts.storeFactory) return opts.storeFactory(env)
  const sync = opts.syncAdminDbFactory?.(env) ?? null
  if (sync) return createSyncReviewCentralStore(sync)
  return createD1ReviewCentralStore(env.DB)
}

async function resolveAuth(
  c: {
    env: WorkerBindings
    req: { raw: Request }
    get: (k: 'authServices') => AuthEnv['Variables']['authServices']
  },
  id: JsonRpcId,
): Promise<{ oauthProps: ReviewMcpOAuthProps | null } | Response> {
  const oauthProps = await tryValidateReviewMcpOAuthToken(c.env, c.req.raw)
  if (oauthProps) return { oauthProps }
  try {
    await authenticateHumanWithOptionalSuperadmin(
      c.get('authServices'),
      c.req.raw,
      { verifySuperadmin: true },
    )
    return { oauthProps: null }
  } catch (err) {
    if (isAuthError(err) && err.status === 401) {
      return unauthorizedMcpResponse(c.env, c.req.raw.url, err.message)
    }
    // Clientes MCP (Cursor URL) frequentemente não enviam Origin. Se não há Cookie
    // de sessão, origin_rejected não protege CSRF — devolver desafio OAuth 401.
    if (
      isAuthError(err) &&
      err.code === 'origin_rejected' &&
      !c.req.raw.headers.get('Cookie')
    ) {
      return unauthorizedMcpResponse(c.env, c.req.raw.url, err.message)
    }
    return authErrorResponse(id, err)
  }
}

async function handleMcpMethod(
  msg: JsonRpcRequest,
  c: {
    env: WorkerBindings
    req: { raw: Request }
    get: (k: 'authServices') => AuthEnv['Variables']['authServices']
  },
  opts: ReviewCentralMcpRouteOptions,
): Promise<Response> {
  const id = requestId(msg)
  const clock = opts.clockFactory?.() ?? systemClock

  if (msg.id === undefined && msg.method.startsWith('notifications/')) {
    return new Response(null, { status: 202 })
  }

  switch (msg.method) {
    case 'initialize':
      return Response.json(
        jsonRpcSuccess(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
          instructions:
            'MCP cross-tenant só leitura das amostras de revisão (D1 central). Sem tenantId obrigatório. Auth: OAuth MCP (superadmin) ou Bearer Clerk session de superadmin.',
        }),
      )
    case 'ping':
      return Response.json(jsonRpcSuccess(id, {}))
    case 'tools/list': {
      const auth = await resolveAuth(c, id)
      if (auth instanceof Response) return auth
      return Response.json(
        jsonRpcSuccess(id, {
          tools: REVIEW_CENTRAL_MCP_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: t.annotations,
          })),
        }),
      )
    }
    case 'tools/call': {
      const auth = await resolveAuth(c, id)
      if (auth instanceof Response) return auth
      const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown }
      const name = typeof params.name === 'string' ? params.name : ''
      if (!name) {
        return Response.json(
          jsonRpcError(id, JSON_RPC_INVALID_REQUEST, 'tools/call exige name'),
          { status: 400 },
        )
      }
      const result = await callReviewCentralMcpTool(name, params.arguments, {
        services: c.get('authServices'),
        request: c.req.raw,
        store: resolveStore(c.env, opts),
        nowMs: () => clock.nowMs(),
        oauthProps: auth.oauthProps,
      })
      return Response.json(jsonRpcSuccess(id, result))
    }
    default:
      return Response.json(
        jsonRpcError(id, JSON_RPC_METHOD_NOT_FOUND, `Método não suportado: ${msg.method}`),
        { status: 400 },
      )
  }
}

export function createReviewCentralMcpRoutes(opts: ReviewCentralMcpRouteOptions) {
  const app = new Hono<McpEnv>()

  // OAuth discovery + token/register (quando OAUTH_KV existe).
  app.all('/oauth/*', async (c) => {
    const passthrough = await handleReviewMcpOAuthPassthrough(c.req.raw, c.env)
    if (passthrough) return passthrough
    return c.json({ error: 'oauth_not_configured' }, 503)
  })
  app.get('/.well-known/oauth-authorization-server', (c) =>
    fetchOAuthAuthorizationServerMeta(c.req.raw, c.env),
  )
  app.get('/.well-known/openid-configuration', (c) =>
    fetchOAuthAuthorizationServerMeta(c.req.raw, c.env),
  )
  app.get('/.well-known/oauth-protected-resource', (c) =>
    c.json(resourceMetadataBody(c.env, c.req.url)),
  )

  app.use('/authorize', createAuthServicesMiddleware(opts.authServicesFactory))
  app.all('/authorize', async (c) =>
    handleReviewMcpAuthorize(c.req.raw, c.env, c.get('authServices')),
  )

  app.use(
    '/api/mcp/review-central',
    createAuthServicesMiddleware(opts.authServicesFactory),
  )
  app.use(
    '/api/mcp/review-central/*',
    createAuthServicesMiddleware(opts.authServicesFactory),
  )

  app.get('/api/mcp/review-central', (c) =>
    c.json(
      {
        error: 'method_not_allowed',
        message:
          'MCP review-central é POST JSON-RPC stateless (sem SSE GET neste corte).',
        oauth: oauthKvConfigured(c.env),
      },
      405,
    ),
  )

  app.post('/api/mcp/review-central', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(jsonRpcError(null, JSON_RPC_PARSE_ERROR, 'JSON inválido'), 400)
    }

    if (Array.isArray(body)) {
      return c.json(
        jsonRpcError(null, JSON_RPC_INVALID_REQUEST, 'Batch JSON-RPC não suportado'),
        400,
      )
    }

    if (!isJsonRpcRequest(body)) {
      return c.json(
        jsonRpcError(null, JSON_RPC_INVALID_REQUEST, 'Pedido JSON-RPC inválido'),
        400,
      )
    }

    return handleMcpMethod(body, c, opts)
  })

  return app
}
