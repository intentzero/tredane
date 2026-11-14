/**
 * MCP de laboratório (DEC-182) — JSON-RPC stateless, só staging e só o tenant demo.
 * Auth: Bearer `LAB_TOKEN`. Separado do Review MCP (DEC-159), que é só leitura.
 */
import { Hono } from 'hono'
import { workerCaller } from '../clinic'
import { DEMO_CLINIC_TENANT_ID } from '../clinic/demo/ids'
import {
  isJsonRpcRequest,
  jsonRpcError,
  jsonRpcSuccess,
  toolErrorResult,
  toolTextResult,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  MCP_PROTOCOL_VERSION,
  type JsonRpcRequest,
} from '../mcp/review-central/protocol'
import type { WorkerBindings } from '../worker/bindings'
import type { LabStateResult } from './turn'
import { bearerMatches, isLabEnabled, labMaxTurnsDaily, resolveLabWaId } from './gate'

const SERVER_INFO = { name: 'tredane-lab', version: '1.0.0' }

const WA_ID_PROP = {
  type: 'string',
  description:
    'Número fictício da cliente (prefixo 5500…, 12 a 15 dígitos). Omitido: 550000000001. Outro número = outra cliente.',
}

export const LAB_TOOLS = [
  {
    name: 'lab_status',
    description:
      'Estado do laboratório: tenant demo, teto diário de turnos e quantos já foram usados. Chamar primeiro.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'lab_say',
    description:
      'A cliente fictícia envia uma mensagem de texto e a IA da clínica demo responde (chama o modelo; conta no teto diário). Devolve as mensagens novas e, se a resposta trouxe botões ou lista, o que se pode tocar com lab_tap.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 1000 },
        waId: WA_ID_PROP,
        displayName: { type: 'string', maxLength: 60 },
      },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'lab_tap',
    description:
      'A cliente fictícia toca num botão ou numa linha de lista de uma resposta anterior. Usar o id e o título devolvidos em `options`/`tappable` por lab_say ou lab_tap. Confirmar é um botão: só ele marca (DEC-061).',
    inputSchema: {
      type: 'object',
      properties: {
        buttonId: { type: 'string', minLength: 1, maxLength: 256 },
        title: { type: 'string', minLength: 1, maxLength: 80 },
        kind: { type: 'string', enum: ['button', 'list'] },
        waId: WA_ID_PROP,
      },
      required: ['buttonId', 'title'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'lab_state',
    description:
      'Estado da clínica demo para uma cliente: contato, conversa, mensagens, propostas, jobs da IA e as marcações da clínica. Só leitura.',
    inputSchema: {
      type: 'object',
      properties: { waId: WA_ID_PROP, messageLimit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
] as const

type Args = Record<string, unknown>

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v : null
}

export async function callLabTool(name: string, rawArgs: unknown, env: WorkerBindings) {
  const args: Args = rawArgs && typeof rawArgs === 'object' ? (rawArgs as Args) : {}
  const stub = env.CLINIC.get(env.CLINIC.idFromName(DEMO_CLINIC_TENANT_ID))
  const caller = workerCaller(DEMO_CLINIC_TENANT_ID)
  const waId = resolveLabWaId(args.waId)
  if (name !== 'lab_status' && !waId) {
    return toolErrorResult('waId inválido: usar 5500 + 8 a 11 dígitos.')
  }
  try {
    switch (name) {
      case 'lab_status': {
        const s = (await stub.labState(caller, {
          waId: resolveLabWaId(undefined)!,
          messageLimit: 1,
        })) as unknown as LabStateResult
        return toolTextResult({
          environment: env.ENVIRONMENT,
          tenantId: DEMO_CLINIC_TENANT_ID,
          turnsUsedToday: s.turnsUsedToday,
          turnsCapToday: labMaxTurnsDaily(env),
        })
      }
      case 'lab_say': {
        const text = str(args.text, 1000)
        if (!text) return toolErrorResult('text obrigatório (até 1000 caracteres).')
        const displayName = str(args.displayName, 60) ?? undefined
        return toolTextResult(await stub.labTurn(caller, { waId: waId!, displayName, text }))
      }
      case 'lab_tap': {
        const buttonId = str(args.buttonId, 256)
        const title = str(args.title, 80)
        if (!buttonId || !title) return toolErrorResult('buttonId e title obrigatórios.')
        const kind = args.kind === 'list' ? 'list' : 'button'
        return toolTextResult(await stub.labTurn(caller, { waId: waId!, tap: { buttonId, title, kind } }))
      }
      case 'lab_state': {
        const limit = typeof args.messageLimit === 'number' ? args.messageLimit : undefined
        return toolTextResult(await stub.labState(caller, { waId: waId!, messageLimit: limit }))
      }
      default:
        return toolErrorResult(`Ferramenta desconhecida: ${name}`)
    }
  } catch (err) {
    const code = (err as { code?: string }).code
    return toolErrorResult(err instanceof Error ? err.message.slice(0, 300) : 'lab_failed', code ? { code } : undefined)
  }
}

async function handle(msg: JsonRpcRequest, env: WorkerBindings): Promise<Response> {
  const id = msg.id === undefined ? null : msg.id
  if (msg.id === undefined && msg.method.startsWith('notifications/')) {
    return new Response(null, { status: 202 })
  }
  switch (msg.method) {
    case 'initialize':
      return Response.json(
        jsonRpcSuccess(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'Laboratório conversacional (DEC-182): só staging, só a clínica demo, nada sai para a Meta. Comece por lab_status; converse com lab_say e lab_tap; leia lab_state. Ver docs/implementation/runbooks/laboratorio-mcp.md.',
        }),
      )
    case 'ping':
      return Response.json(jsonRpcSuccess(id, {}))
    case 'tools/list':
      return Response.json(jsonRpcSuccess(id, { tools: LAB_TOOLS }))
    case 'tools/call': {
      const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown }
      const name = typeof params.name === 'string' ? params.name : ''
      if (!name) {
        return Response.json(jsonRpcError(id, JSON_RPC_INVALID_REQUEST, 'tools/call exige name'), { status: 400 })
      }
      return Response.json(jsonRpcSuccess(id, await callLabTool(name, params.arguments, env)))
    }
    default:
      return Response.json(
        jsonRpcError(id, JSON_RPC_METHOD_NOT_FOUND, `Método não suportado: ${msg.method}`),
        { status: 400 },
      )
  }
}

export function createLabMcpRoutes() {
  const app = new Hono<{ Bindings: WorkerBindings }>()
  app.post('/api/mcp/lab', async (c) => {
    if (!isLabEnabled(c.env)) return c.json({ error: 'not_found' }, 404)
    if (!bearerMatches(c.req.header('Authorization'), c.env.LAB_TOKEN!)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    c.header('Cache-Control', 'no-store')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(jsonRpcError(null, JSON_RPC_PARSE_ERROR, 'JSON inválido'), 400)
    }
    if (Array.isArray(body) || !isJsonRpcRequest(body)) {
      return c.json(jsonRpcError(null, JSON_RPC_INVALID_REQUEST, 'Pedido JSON-RPC inválido'), 400)
    }
    return handle(body, c.env)
  })
  app.all('/api/mcp/lab', (c) => (isLabEnabled(c.env) ? c.json({ error: 'method_not_allowed' }, 405) : c.json({ error: 'not_found' }, 404)))
  return app
}
