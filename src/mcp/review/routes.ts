/**
 * MCP read-only de revisão de conversas (DEC-158) — Streamable HTTP JSON-RPC.
 * Auth = painel (Clerk session Bearer / synthetic); tools exigem tenantId + membership.
 */
import { Hono } from 'hono'
import { authenticateHuman } from '../../auth/authorize'
import { isAuthError } from '../../auth/errors'
import {
  createAuthServicesMiddleware,
  type AuthDepsFactory,
  type AuthEnv,
} from '../../auth/middleware'
import type { WorkerBindings } from '../../worker/bindings'
import {
  createClinicDoInboxGateway,
  type InboxGateway,
} from '../../inbox/gateway'
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
import { REVIEW_MCP_TOOLS, callReviewMcpTool } from './tools'

type McpEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type ReviewMcpGatewayFactory = (
  env: WorkerBindings,
  tenantId: string,
) => InboxGateway | Promise<InboxGateway>

export type ReviewMcpRouteOptions = {
  authServicesFactory: AuthDepsFactory
  /** Reusa o mesmo factory do inbox (DO ou memória nos testes). */
  inboxGatewayFactory?: ReviewMcpGatewayFactory
}

const JSON_RPC_UNAUTHENTICATED = -32001

async function resolveGateway(
  env: WorkerBindings,
  tenantId: string,
  opts: ReviewMcpRouteOptions,
): Promise<InboxGateway> {
  if (opts.inboxGatewayFactory) return opts.inboxGatewayFactory(env, tenantId)
  return createClinicDoInboxGateway(env, tenantId)
}

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

async function requireSession(
  c: {
    req: { raw: Request }
    get: (k: 'authServices') => AuthEnv['Variables']['authServices']
  },
  id: JsonRpcId,
): Promise<Response | null> {
  try {
    await authenticateHuman(c.get('authServices'), c.req.raw)
    return null
  } catch (err) {
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
  opts: ReviewMcpRouteOptions,
): Promise<Response> {
  const id = requestId(msg)

  // Notificações (sem id) — aceitar e não responder corpo JSON-RPC.
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
            'MCP multi-tenant só leitura da fila Para revisão. Passe sempre tenantId. Auth: Bearer Clerk session_token (igual ao painel).',
        }),
      )
    case 'ping':
      return Response.json(jsonRpcSuccess(id, {}))
    case 'tools/list': {
      const denied = await requireSession(c, id)
      if (denied) return denied
      return Response.json(
        jsonRpcSuccess(id, {
          tools: REVIEW_MCP_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: t.annotations,
          })),
        }),
      )
    }
    case 'tools/call': {
      // Sem Bearer → 401 (Confirmado); membership/tenant continua a ser validado na tool.
      const denied = await requireSession(c, id)
      if (denied) return denied
      const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown }
      const name = typeof params.name === 'string' ? params.name : ''
      if (!name) {
        return Response.json(
          jsonRpcError(id, JSON_RPC_INVALID_REQUEST, 'tools/call exige name'),
          { status: 400 },
        )
      }
      const result = await callReviewMcpTool(name, params.arguments, {
        services: c.get('authServices'),
        request: c.req.raw,
        resolveGateway: (tenantId) => resolveGateway(c.env, tenantId, opts),
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

export function createReviewMcpRoutes(opts: ReviewMcpRouteOptions) {
  const app = new Hono<McpEnv>()

  app.use('/api/mcp/review', createAuthServicesMiddleware(opts.authServicesFactory))
  app.use('/api/mcp/review/*', createAuthServicesMiddleware(opts.authServicesFactory))

  app.get('/api/mcp/review', (c) =>
    c.json(
      {
        error: 'method_not_allowed',
        message: 'MCP review é POST JSON-RPC stateless (sem SSE GET neste corte).',
      },
      405,
    ),
  )

  app.post('/api/mcp/review', async (c) => {
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
