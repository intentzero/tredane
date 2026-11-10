/**
 * Tools MCP read-only sobre a API DEC-157 /review (DEC-158).
 * Diagnóstico é agent-side: o servidor só devolve dados + guidance fixa.
 */
import type { AuthServices } from '../../auth'
import {
  authenticateHuman,
  requireClinicPermission,
  resolveTenantContext,
} from '../../auth/authorize'
import { isAuthError } from '../../auth/errors'
import {
  ClinicError,
  NotFoundError,
  ValidationError,
  workerCaller,
} from '../../clinic'
import type { InboxGateway } from '../../inbox/gateway'
import {
  serializeConversation,
  serializeConversationDetail,
  serializeCounts,
} from '../../inbox/serialize'
import {
  JSON_RPC_APPLICATION_ERROR,
  JSON_RPC_INVALID_PARAMS,
  toolErrorResult,
  toolTextResult,
} from './protocol'

export const DIAGNOSIS_GUIDANCE = [
  'Escreva um diagnóstico curto em português (3–6 frases) com base só nos dados devolvidos.',
  'Indique: (1) gatilho da flag (client / staff / auto + reason tipada);',
  '(2) passo provável do funil de marcação;',
  '(3) se a fricção parece «Não encontrei», pedido explícito da cliente, ou marcação manual da equipe;',
  '(4) uma hipótese de melhoria (copy, match, handoff) sem inventar mensagens que não estão no fio.',
  'Não peça ao servidor para gravar o diagnóstico — este MCP é só leitura.',
].join(' ')

export type ReviewMcpToolName =
  | 'list_review_conversations'
  | 'get_review_conversation'
  | 'propose_review_diagnosis'

export const REVIEW_MCP_TOOLS = [
  {
    name: 'list_review_conversations' as const,
    description:
      'Lista conversas flagged «Para revisão» da clínica activa (tenant). Só leitura; exige membership + clinic.inbox.read.',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: {
          type: 'string',
          description: 'ID da clínica activa (obrigatório; nunca omitir nem reutilizar de outro tenant).',
        },
        before: {
          type: 'number',
          description: 'Cursor de paginação (epoch ms); opcional.',
        },
        limit: {
          type: 'number',
          description: 'Limite de itens; opcional.',
        },
      },
      required: ['tenantId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_review_conversation' as const,
    description:
      'Detalhe de uma conversa na fila de revisão, com mensagens do Durable Object da clínica. 404 se não estiver flagged.',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: {
          type: 'string',
          description: 'ID da clínica activa.',
        },
        conversationId: {
          type: 'string',
          description: 'ID da conversa flagged.',
        },
        before: {
          type: 'number',
          description: 'Cursor de mensagens (epoch ms); opcional.',
        },
        messageLimit: {
          type: 'number',
          description: 'Limite de mensagens; opcional.',
        },
      },
      required: ['tenantId', 'conversationId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'propose_review_diagnosis' as const,
    description:
      'Devolve o fio flagged + guidance fixa para o agente propor um diagnóstico. O servidor não chama LLM nem persiste nota.',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: {
          type: 'string',
          description: 'ID da clínica activa.',
        },
        conversationId: {
          type: 'string',
          description: 'ID da conversa flagged.',
        },
        before: {
          type: 'number',
          description: 'Cursor de mensagens (epoch ms); opcional.',
        },
        messageLimit: {
          type: 'number',
          description: 'Limite de mensagens; opcional.',
        },
      },
      required: ['tenantId', 'conversationId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
]

export type ReviewMcpDeps = {
  services: AuthServices
  request: Request
  resolveGateway: (tenantId: string) => Promise<InboxGateway>
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function requireString(
  args: Record<string, unknown>,
  key: string,
): string {
  const v = args[key]
  if (typeof v !== 'string' || v.trim() === '') {
    throw Object.assign(new Error(`Parâmetro ${key} obrigatório`), {
      rpcCode: JSON_RPC_INVALID_PARAMS,
      appCode: 'invalid_params',
    })
  }
  return v.trim()
}

function optionalFiniteNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = args[key]
  if (v == null || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) {
    throw Object.assign(new Error(`Parâmetro ${key} inválido`), {
      rpcCode: JSON_RPC_INVALID_PARAMS,
      appCode: 'invalid_params',
    })
  }
  return n
}

async function authorizeTenant(
  deps: ReviewMcpDeps,
  tenantId: string,
): Promise<{ clerkUserId: string }> {
  const principal = await authenticateHuman(deps.services, deps.request)
  const ctx = await resolveTenantContext(deps.services, principal, tenantId)
  requireClinicPermission(ctx, 'clinic.inbox.read')
  return { clerkUserId: principal.clerkUserId }
}

function mapToolFailure(err: unknown): ReturnType<typeof toolErrorResult> {
  if (isAuthError(err)) {
    return toolErrorResult(err.message || err.code, {
      error: err.code,
      status: err.status,
    })
  }
  if (err instanceof ValidationError) {
    return toolErrorResult(err.message, { error: err.code, status: 400 })
  }
  if (err instanceof NotFoundError) {
    return toolErrorResult(err.message, { error: err.code, status: 404 })
  }
  if (err instanceof ClinicError) {
    const status =
      err.code === 'tenant_mismatch' || err.code === 'unauthorized_caller'
        ? 403
        : 400
    return toolErrorResult(err.message, { error: err.code, status })
  }
  if (
    err &&
    typeof err === 'object' &&
    'rpcCode' in err &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    const e = err as { message: string; appCode?: string; rpcCode: number }
    return toolErrorResult(e.message, {
      error: e.appCode ?? 'invalid_params',
      rpcCode: e.rpcCode,
    })
  }
  return toolErrorResult(
    err instanceof Error ? err.message : 'mcp_tool_error',
    { error: 'mcp_tool_error', status: 500 },
  )
}

export async function callReviewMcpTool(
  name: string,
  rawArgs: unknown,
  deps: ReviewMcpDeps,
): Promise<ReturnType<typeof toolTextResult> | ReturnType<typeof toolErrorResult>> {
  try {
    const args = asRecord(rawArgs)
    switch (name) {
      case 'list_review_conversations': {
        const tenantId = requireString(args, 'tenantId')
        const { clerkUserId } = await authorizeTenant(deps, tenantId)
        const before = optionalFiniteNumber(args, 'before')
        const limit = optionalFiniteNumber(args, 'limit')
        const gw = await deps.resolveGateway(tenantId)
        const result = await gw.listReviewConversations(
          workerCaller(tenantId, clerkUserId),
          {
            filter: 'for_review',
            before: before ?? null,
            limit,
            viewerClerkUserId: clerkUserId,
          },
        )
        return toolTextResult({
          tenantId,
          conversations: result.items.map(serializeConversation),
          nextBefore: result.nextBefore,
          counts: serializeCounts(result.counts),
        })
      }
      case 'get_review_conversation': {
        const tenantId = requireString(args, 'tenantId')
        const conversationId = requireString(args, 'conversationId')
        const { clerkUserId } = await authorizeTenant(deps, tenantId)
        const before = optionalFiniteNumber(args, 'before')
        const messageLimit = optionalFiniteNumber(args, 'messageLimit')
        const gw = await deps.resolveGateway(tenantId)
        const detail = await gw.getReviewConversation(
          workerCaller(tenantId, clerkUserId),
          { conversationId, before: before ?? null, messageLimit },
        )
        return toolTextResult({
          ...serializeConversationDetail(detail),
          requestedTenantId: tenantId,
        })
      }
      case 'propose_review_diagnosis': {
        const tenantId = requireString(args, 'tenantId')
        const conversationId = requireString(args, 'conversationId')
        const { clerkUserId } = await authorizeTenant(deps, tenantId)
        const before = optionalFiniteNumber(args, 'before')
        const messageLimit = optionalFiniteNumber(args, 'messageLimit')
        const gw = await deps.resolveGateway(tenantId)
        const detail = await gw.getReviewConversation(
          workerCaller(tenantId, clerkUserId),
          { conversationId, before: before ?? null, messageLimit },
        )
        // Contrato Confirmado: conversation + messages + diagnosisGuidance (mensagens no topo).
        const serialized = serializeConversationDetail(detail)
        const { messages, messagesHasMore, messagesNextBefore, ...conversation } =
          serialized
        return toolTextResult({
          requestedTenantId: tenantId,
          conversation,
          messages,
          messagesHasMore,
          messagesNextBefore,
          diagnosisGuidance: DIAGNOSIS_GUIDANCE,
          note: 'agent_side_diagnosis_only',
        })
      }
      default:
        return toolErrorResult(`Tool desconhecida: ${name}`, {
          error: 'tool_not_found',
          rpcCode: JSON_RPC_APPLICATION_ERROR,
        })
    }
  } catch (err) {
    return mapToolFailure(err)
  }
}
