/**
 * Tools MCP cross-tenant sobre amostras D1 (DEC-159).
 * Sem tenantId obrigatório; só superadmin (OAuth ou Bearer Clerk).
 */
import type { AuthServices } from '../../auth'
import { authenticateHumanWithOptionalSuperadmin } from '../../auth/authorize'
import { requireVerifiedSuperadmin } from '../../auth/superadmin'
import { isAuthError } from '../../auth/errors'
import {
  getReviewSampleD1,
  getReviewSampleSync,
  listReviewSamplesD1,
  listReviewSamplesSync,
  REVIEW_SAMPLES_SCOPE,
  type ReviewSampleDetail,
} from '../../review-samples'
import type { AdminDb } from '../../db/admin/store'
import {
  JSON_RPC_APPLICATION_ERROR,
  JSON_RPC_INVALID_PARAMS,
  toolErrorResult,
  toolTextResult,
} from './protocol'

export const DIAGNOSIS_GUIDANCE = [
  'Escreva um diagnóstico curto em português (3–6 frases) com base só nos dados devolvidos.',
  'Indique: (1) clínica (tenantId / tenantName) e gatilho da flag (client / staff / auto + reason);',
  '(2) passo provável do funil de marcação;',
  '(3) se a fricção parece «Não encontrei», pedido explícito da cliente, ou marcação manual;',
  '(4) se `clientComments` (DEC-167) ou `clientComment` (DEC-166) tiver texto, trate cada item como observação da cliente sobre a anomalia — use todos, não só o primeiro;',
  '(5) uma hipótese de melhoria (copy, match, handoff) sem inventar mensagens que não estão no fio.',
  'Não peça ao servidor para gravar o diagnóstico — este MCP é só leitura.',
].join(' ')

export const REVIEW_CENTRAL_MCP_TOOLS = [
  {
    name: 'list_review_samples' as const,
    description:
      'Lista amostras de revisão de todos os tenants (filtro tenantId/source opcional). Inclui clientComments (array DEC-167) e clientComment (1.º) quando a cliente escreveu texto após «avaliar»/«feedback». Só leitura; exige superadmin.',
    inputSchema: {
      type: 'object',
      properties: {
        before: {
          type: 'number',
          description: 'Cursor de paginação (flaggedAt epoch ms); opcional.',
        },
        limit: { type: 'number', description: 'Limite de itens; opcional.' },
        tenantId: {
          type: 'string',
          description: 'Filtro opcional por clínica.',
        },
        source: {
          type: 'string',
          description: 'Filtro opcional: client | staff | auto.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_review_sample' as const,
    description:
      'Detalhe de uma amostra central + mensagens do snapshot. clientComments (DEC-167) traz todas as observações Avaliar/feedback; clientComment é o 1.º. 404 se inexistente ou expirada.',
    inputSchema: {
      type: 'object',
      properties: {
        sampleId: {
          type: 'string',
          description: 'ID da amostra (review_samples.id).',
        },
      },
      required: ['sampleId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'propose_review_diagnosis' as const,
    description:
      'Devolve a amostra (incl. clientComments DEC-167 / clientComment) + guidance fixa para o agente propor um diagnóstico. Sem LLM no Worker; sem persistir nota.',
    inputSchema: {
      type: 'object',
      properties: {
        sampleId: {
          type: 'string',
          description: 'ID da amostra.',
        },
      },
      required: ['sampleId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
]

export type ReviewCentralStore = {
  list: (opts: {
    before?: number | null
    limit?: number
    tenantId?: string | null
    source?: string | null
    nowMs: number
  }) => Promise<{ items: unknown[]; nextBefore: number | null }>
  get: (
    sampleId: string,
    nowMs: number,
  ) => Promise<ReviewSampleDetail | null>
}

export function createD1ReviewCentralStore(d1: D1Database): ReviewCentralStore {
  return {
    list: (opts) => listReviewSamplesD1(d1, opts),
    get: (sampleId, nowMs) => getReviewSampleD1(d1, sampleId, nowMs),
  }
}

export function createSyncReviewCentralStore(db: AdminDb): ReviewCentralStore {
  return {
    list: async (opts) => listReviewSamplesSync(db, opts),
    get: async (sampleId, nowMs) => getReviewSampleSync(db, sampleId, nowMs),
  }
}

export type ReviewCentralMcpDeps = {
  services: AuthServices
  request: Request
  store: ReviewCentralStore
  nowMs: () => number
  /** Props já validados via OAuth (skip Clerk session). */
  oauthProps?: { clerkUserId: string; scope: string[] } | null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string' || v.trim() === '') {
    throw Object.assign(new Error(`Parâmetro ${key} obrigatório`), {
      rpcCode: JSON_RPC_INVALID_PARAMS,
      appCode: 'invalid_params',
    })
  }
  return v.trim()
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = args[key]
  if (v == null || v === '') return undefined
  if (typeof v !== 'string') {
    throw Object.assign(new Error(`Parâmetro ${key} inválido`), {
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

async function requireSuperadminAccess(
  deps: ReviewCentralMcpDeps,
): Promise<{ clerkUserId: string }> {
  if (deps.oauthProps) {
    if (!deps.oauthProps.scope.includes(REVIEW_SAMPLES_SCOPE)) {
      throw Object.assign(new Error('Escopo review_samples:read exigido'), {
        status: 403,
        code: 'insufficient_scope',
      })
    }
    // DEC-159: revalidar privateMetadata.superadmin em cada tools/call
    // (não confiar só no props do token após revogação).
    await requireVerifiedSuperadmin(
      deps.services.authority,
      deps.oauthProps.clerkUserId,
    )
    return { clerkUserId: deps.oauthProps.clerkUserId }
  }
  const principal = await authenticateHumanWithOptionalSuperadmin(
    deps.services,
    deps.request,
    { verifySuperadmin: true },
  )
  return { clerkUserId: principal.clerkUserId }
}

function mapToolFailure(err: unknown): ReturnType<typeof toolErrorResult> {
  if (isAuthError(err)) {
    return toolErrorResult(err.message || err.code, {
      error: err.code,
      status: err.status,
    })
  }
  if (
    err &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    const e = err as { message: string; status?: number; code?: string }
    return toolErrorResult(e.message, {
      error: e.code ?? 'forbidden',
      status: e.status ?? 403,
    })
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

export async function callReviewCentralMcpTool(
  name: string,
  rawArgs: unknown,
  deps: ReviewCentralMcpDeps,
): Promise<ReturnType<typeof toolTextResult> | ReturnType<typeof toolErrorResult>> {
  try {
    await requireSuperadminAccess(deps)
    const args = asRecord(rawArgs)
    const nowMs = deps.nowMs()
    switch (name) {
      case 'list_review_samples': {
        const before = optionalFiniteNumber(args, 'before')
        const limit = optionalFiniteNumber(args, 'limit')
        const tenantId = optionalString(args, 'tenantId')
        const source = optionalString(args, 'source')
        const result = await deps.store.list({
          before: before ?? null,
          limit,
          tenantId: tenantId ?? null,
          source: source ?? null,
          nowMs,
        })
        return toolTextResult({
          samples: result.items,
          nextBefore: result.nextBefore,
          scope: REVIEW_SAMPLES_SCOPE,
        })
      }
      case 'get_review_sample': {
        const sampleId = requireString(args, 'sampleId')
        const detail = await deps.store.get(sampleId, nowMs)
        if (!detail) {
          return toolErrorResult('Amostra não encontrada ou expirada', {
            error: 'review_sample_not_found',
            status: 404,
          })
        }
        return toolTextResult(detail)
      }
      case 'propose_review_diagnosis': {
        const sampleId = requireString(args, 'sampleId')
        const detail = await deps.store.get(sampleId, nowMs)
        if (!detail) {
          return toolErrorResult('Amostra não encontrada ou expirada', {
            error: 'review_sample_not_found',
            status: 404,
          })
        }
        const { messages, ...sample } = detail
        return toolTextResult({
          sample,
          messages,
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
