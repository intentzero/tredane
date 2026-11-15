/**
 * MCP de laboratório (DEC-186) — JSON-RPC stateless, só staging e só o tenant demo.
 * Auth: OAuth MCP (consentimento de superadmin, escopo `lab:converse`, audiência própria). Separado do Review MCP (DEC-159), que é só leitura.
 */
import { Hono } from 'hono'
import { workerCaller } from '../clinic'
import { DEMO_CLINIC_TENANT_ID } from '../clinic/demo/ids'
import { clinicDurableObjectName } from '../clinic/demo/do-name'
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
import {
  labResourceMetadataBody,
  tryValidateLabMcpOAuthToken,
  unauthorizedLabMcpResponse,
  type ReviewMcpOAuthProps,
} from '../mcp/review-central/oauth'
import type { WorkerBindings } from '../worker/bindings'
import type { LabStateResult, LabTurnResult } from './turn'
import { isLabEnabled, labMaxTurnsDaily, resolveLabWaId } from './gate'

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
  {
    name: 'lab_config_get',
    description:
      'Configuração completa da clínica demo (serviços com variantes, salas, profissionais, horários, bloqueios). Só leitura; usar antes de alterar e para obter os ids.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'lab_config_service',
    description:
      'Cria (sem id) ou atualiza um serviço da clínica demo. Aceita os mesmos campos do painel (name, durationMinutes, bufferMinutes, professionalIds, roomRequirement, audiencia, priceCents, variantKind/variantKindPlural, variantSelection, synonyms, weeklyWindows, tempo…). Omitido na edição mantém. A validação é a do painel: um erro diz o que falta.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        durationMinutes: { type: 'integer' },
        bufferMinutes: { type: 'integer' },
        professionalIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'durationMinutes', 'bufferMinutes', 'professionalIds'],
      additionalProperties: true,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'lab_config_service_active',
    description: 'Ativa ou desativa um serviço (não há apagar no laboratório).',
    inputSchema: {
      type: 'object',
      properties: { serviceId: { type: 'string' }, active: { type: 'boolean' } },
      required: ['serviceId', 'active'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'lab_config_zones',
    description:
      'Substitui as variantes/zonas de um serviço da clínica demo (mesmo PUT do painel: name, audience, durationMinutes, priceCents, synonyms, clientExplanation…). Lista completa; omitir um campo numa zona existente mantém o valor.',
    inputSchema: {
      type: 'object',
      properties: {
        serviceId: { type: 'string' },
        zones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              audience: { type: 'string' },
              durationMinutes: { type: 'integer' },
              priceCents: { type: ['integer', 'null'] },
              active: { type: 'boolean' },
              synonyms: { type: 'array', items: { type: 'string' } },
              clientExplanation: { type: ['string', 'null'] },
            },
            required: ['name', 'audience'],
            additionalProperties: true,
          },
        },
      },
      required: ['serviceId', 'zones'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'lab_config_resource',
    description:
      'Cria (sem id) ou atualiza uma sala, profissional ou equipamento (kind, name, capacity, attendanceMode, sameSexInSlot, hoursMode, homeRoomId…). Mesma validação do painel.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, kind: { type: 'string' }, name: { type: 'string' } },
      required: ['kind', 'name'],
      additionalProperties: true,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'lab_config_resource_active',
    description: 'Ativa ou desativa uma sala, profissional ou equipamento.',
    inputSchema: {
      type: 'object',
      properties: { resourceId: { type: 'string' }, active: { type: 'boolean' } },
      required: ['resourceId', 'active'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'lab_config_windows',
    description:
      'Substitui as faixas semanais de um recurso (ou da clínica inteira, com o id de escopo da clínica). dayOfWeek e minutos desde a meia-noite.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceId: { type: 'string' },
        windows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dayOfWeek: { type: 'integer' },
              startMinute: { type: 'integer' },
              endMinute: { type: 'integer' },
            },
            required: ['dayOfWeek', 'startMinute', 'endMinute'],
          },
        },
      },
      required: ['resourceId', 'windows'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'lab_config_block',
    description:
      'Cria um bloqueio de agenda num recurso (resourceId, startsAt, endsAt em ms, reason, note). Com dryRun: true só lista os compromissos afetados.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceId: { type: 'string' },
        startsAt: { type: 'integer' },
        endsAt: { type: 'integer' },
        reason: { type: 'string' },
        dryRun: { type: 'boolean' },
      },
      required: ['resourceId', 'startsAt', 'endsAt', 'reason'],
      additionalProperties: true,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'lab_config_ai_assist',
    description:
      'Liga ou desliga a IA assistiva da clínica demo (mesmo opt-in do painel). Sem isto ligado, lab_say grava o inbound mas não responde.',
    inputSchema: {
      type: 'object',
      properties: { enabled: { type: 'boolean' } },
      required: ['enabled'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
] as const

type Args = Record<string, unknown>

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v : null
}

export async function callLabTool(name: string, rawArgs: unknown, env: WorkerBindings, actor = 'mcp') {
  const args: Args = rawArgs && typeof rawArgs === 'object' ? (rawArgs as Args) : {}
  const stub = env.CLINIC.get(env.CLINIC.idFromName(clinicDurableObjectName(DEMO_CLINIC_TENANT_ID)))
  const caller = workerCaller(DEMO_CLINIC_TENANT_ID, `lab:${actor}`)
  const waId = resolveLabWaId(args.waId)
  if ((name === 'lab_say' || name === 'lab_tap' || name === 'lab_state') && !waId) {
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
        let result = (await stub.labTurn(caller, {
          waId: waId!,
          displayName,
          text,
        })) as LabTurnResult
        // DEC-188: Claude corre no Worker/Queue; Lab bloqueia até apply (~15–20 s).
        if (
          result.conversationId &&
          result.aiOutcomes.some((o) => o.status === 'awaiting_llm')
        ) {
          const { waitLabLlmJobs } = await import('./llm-wait')
          await waitLabLlmJobs(env, stub, caller, result.conversationId)
          result = (await stub.labCollectAfterLlm(caller, {
            conversationId: result.conversationId,
            sinceMs: result.startedAt,
            waId: waId!,
          })) as LabTurnResult
        }
        return toolTextResult(result)
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
      case 'lab_config_get':
        return toolTextResult(await stub.labConfig(caller, 'get', {}))
      case 'lab_config_service':
      case 'lab_config_resource':
      case 'lab_config_windows':
      case 'lab_config_block':
        return toolTextResult(await stub.labConfig(caller, name.slice('lab_config_'.length), args))
      case 'lab_config_service_active':
        return toolTextResult(await stub.labConfig(caller, 'service_active', args))
      case 'lab_config_zones': {
        const serviceId = typeof args.serviceId === 'string' ? args.serviceId.trim() : ''
        if (!serviceId) return toolErrorResult('serviceId obrigatório.')
        if (!Array.isArray(args.zones)) return toolErrorResult('zones deve ser uma lista.')
        return toolTextResult(
          await stub.labConfig(caller, 'zones', { serviceId, zones: args.zones }),
        )
      }
      case 'lab_config_resource_active':
        return toolTextResult(await stub.labConfig(caller, 'resource_active', args))
      case 'lab_config_ai_assist':
        if (typeof args.enabled !== 'boolean') {
          return toolErrorResult('enabled (boolean) obrigatório.')
        }
        return toolTextResult(await stub.labConfig(caller, 'ai_assist', { enabled: args.enabled }))
      default:
        return toolErrorResult(`Ferramenta desconhecida: ${name}`)
    }
  } catch (err) {
    const code = (err as { code?: string }).code
    return toolErrorResult(err instanceof Error ? err.message.slice(0, 300) : 'lab_failed', code ? { code } : undefined)
  }
}

async function handle(msg: JsonRpcRequest, env: WorkerBindings, actor: string): Promise<Response> {
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
            'Laboratório conversacional (DEC-186): só staging, só a clínica demo, nada sai para a Meta. Comece por lab_status; converse com lab_say e lab_tap; leia lab_state. Ver docs/implementation/runbooks/laboratorio-mcp.md.',
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
      return Response.json(jsonRpcSuccess(id, await callLabTool(name, params.arguments, env, actor)))
    }
    default:
      return Response.json(
        jsonRpcError(id, JSON_RPC_METHOD_NOT_FOUND, `Método não suportado: ${msg.method}`),
        { status: 400 },
      )
  }
}

export type LabMcpRouteOptions = {
  /** Validação do token (testes). Padrão: access token OAuth do laboratório. */
  validate?: (env: WorkerBindings, request: Request) => Promise<ReviewMcpOAuthProps | null>
}

/** Métodos MCP que o Review deixa abertos sem token — o Cursor precisa disto para montar o sign-in. */
function labMethodAllowsUnauth(method: string): boolean {
  return method === 'initialize' || method === 'ping' || method.startsWith('notifications/')
}

export function createLabMcpRoutes(opts: LabMcpRouteOptions = {}) {
  const validate = opts.validate ?? tryValidateLabMcpOAuthToken
  const app = new Hono<{ Bindings: WorkerBindings }>()
  // RFC 9728 path insertion (canónico) + forma appendida (alguns clientes).
  app.get('/.well-known/oauth-protected-resource/api/mcp/lab', (c) =>
    isLabEnabled(c.env)
      ? c.json(labResourceMetadataBody(c.env, c.req.url))
      : c.json({ error: 'not_found' }, 404),
  )
  app.get('/api/mcp/lab/.well-known/oauth-protected-resource', (c) =>
    isLabEnabled(c.env)
      ? c.json(labResourceMetadataBody(c.env, c.req.url))
      : c.json({ error: 'not_found' }, 404),
  )
  app.post('/api/mcp/lab', async (c) => {
    if (!isLabEnabled(c.env)) return c.json({ error: 'not_found' }, 404)
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
    // Igual ao Review MCP (DEC-159): initialize/ping sem auth; tools/* exigem OAuth.
    // Auth no initialize inteiro fazia o Cursor falhar com «No sign-in link» (só o Lab; o Review funciona).
    if (!labMethodAllowsUnauth(body.method)) {
      const principal = await validate(c.env, c.req.raw)
      if (!principal) return unauthorizedLabMcpResponse(c.env, c.req.url)
      return handle(body, c.env, principal.clerkUserId)
    }
    return handle(body, c.env, 'anonymous')
  })
  app.all('/api/mcp/lab', (c) =>
    isLabEnabled(c.env)
      ? c.json(
          {
            error: 'method_not_allowed',
            message: 'MCP lab é POST JSON-RPC stateless (sem SSE GET neste corte).',
            oauth: true,
          },
          405,
        )
      : c.json({ error: 'not_found' }, 404),
  )
  return app
}
