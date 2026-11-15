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
import { asyncFromSync, fromD1 } from '../../db/admin/async-store'
import {
  parseMetricsWindowFromQuery,
  fetchConversationMetricsReport,
} from '../../conversation-metrics/query'
import type { ConversationMetricsWindow } from '../../conversation-metrics/types'
import {
  listInterpreterShadowEvents,
  SHADOW_REPORT_ROW_LIMIT,
  type ShadowEventRow,
} from '../../shadow-report/store'
import { summariseShadowRows } from '../../shadow-report/summary'
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

/** TEMPORÁRIO: ver hipotese-compreensao-llm-primeiro.md §5.3d (lista de remoção). */
const SHADOW_REPORT_TOOL = {
  name: 'get_interpreter_shadow_report' as const,
  description:
    'TEMPORÁRIO. Resumo agregado da sombra do interpretador LLM (turnos de texto livre): por campo, quantas vezes léxico e modelo concordam, só o modelo leu, só o léxico leu ou se contradizem; validação, cobertura, latência e custo. Com sample>0 devolve ids internos (conversa/mensagem) de divergências para rotular no painel. Sem texto da conversa. Janela por defeito: 24 h.',
  inputSchema: {
    type: 'object',
    properties: {
      sinceHours: { type: 'number', description: 'Janela em horas (1 a 168); por defeito 24.' },
      tenantId: { type: 'string', description: 'Filtro opcional por clínica.' },
      sample: { type: 'number', description: 'Até N ids de divergências por tipo (0 a 50); por defeito 0.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}

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
  SHADOW_REPORT_TOOL,
  {
    name: 'get_conversation_metrics' as const,
    description:
      'Métricas founder-approved de qualidade conversacional por clínica e janela (booking rate, red-line de confirmações falsas, atendente, abandono 24h, turnos até marcar, incompreensões, comparecimento IA). Sem texto de conversa. Só leitura; superadmin.',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string', description: 'Filtro opcional por clínica.' },
        sinceHours: { type: 'number', description: 'Janela em horas (1–2160); default 168 (7 dias).' },
        sinceMs: { type: 'number', description: 'Início epoch ms (alternativa a sinceHours).' },
        untilMs: { type: 'number', description: 'Fim epoch ms; default agora.' },
      },
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
  /** TEMPORÁRIO: linhas da sombra do interpretador (D1 central). */
  shadowEvents?: (opts: {
    sinceMs: number
    tenantId?: string | null
    limit?: number
  }) => Promise<ShadowEventRow[]>
  conversationMetrics?: (
    window: ConversationMetricsWindow,
    nowMs: number,
  ) => ReturnType<typeof fetchConversationMetricsReport>
}

export function createD1ReviewCentralStore(d1: D1Database): ReviewCentralStore {
  const admin = fromD1(d1)
  return {
    list: (opts) => listReviewSamplesD1(d1, opts),
    get: (sampleId, nowMs) => getReviewSampleD1(d1, sampleId, nowMs),
    shadowEvents: (opts) => listInterpreterShadowEvents(admin, opts),
    conversationMetrics: (window, nowMs) => fetchConversationMetricsReport(admin, window, nowMs),
  }
}

export function createSyncReviewCentralStore(db: AdminDb): ReviewCentralStore {
  const asyncDb = asyncFromSync(db)
  return {
    list: async (opts) => listReviewSamplesSync(db, opts),
    get: async (sampleId, nowMs) => getReviewSampleSync(db, sampleId, nowMs),
    shadowEvents: (opts) => listInterpreterShadowEvents(asyncDb, opts),
    conversationMetrics: (window, nowMs) => fetchConversationMetricsReport(asyncDb, window, nowMs),
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
      case 'get_conversation_metrics': {
        if (!deps.store.conversationMetrics) {
          return toolErrorResult('Métricas conversacionais indisponíveis neste armazenamento', {
            error: 'conversation_metrics_unavailable',
            status: 501,
          })
        }
        const window = parseMetricsWindowFromQuery({
          tenantId: optionalString(args, 'tenantId'),
          sinceHours: optionalFiniteNumber(args, 'sinceHours'),
          sinceMs: optionalFiniteNumber(args, 'sinceMs'),
          untilMs: optionalFiniteNumber(args, 'untilMs'),
          nowMs,
        })
        if (!window) {
          return toolErrorResult('Janela inválida (sinceHours/sinceMs/untilMs)', {
            error: 'invalid_params',
            rpcCode: JSON_RPC_INVALID_PARAMS,
          })
        }
        const report = await deps.store.conversationMetrics(window, nowMs)
        return toolTextResult({
          metrics: report,
          howToRead:
            'bookingRate = confirmados/intenção; falseConfirmations deve ser 0 (alerta ops.alert conversation.false_confirmation); messagesToBook mediana vs baseline 6; attendantCalls não é para minimizar à força.',
        })
      }
      case 'get_interpreter_shadow_report': {
        if (!deps.store.shadowEvents) {
          return toolErrorResult('Relatório da sombra indisponível neste armazenamento', {
            error: 'shadow_report_unavailable',
            status: 501,
          })
        }
        const sinceHours = Math.min(Math.max(optionalFiniteNumber(args, 'sinceHours') ?? 24, 1), 168)
        const sample = Math.min(Math.max(optionalFiniteNumber(args, 'sample') ?? 0, 0), 50)
        const tenantId = optionalString(args, 'tenantId')
        const sinceMs = nowMs - sinceHours * 3_600_000
        // Pedir limit+1: truncated só quando há mais linhas do que o teto do resumo.
        const rowsPlus = await deps.store.shadowEvents({
          sinceMs,
          tenantId: tenantId ?? null,
          limit: SHADOW_REPORT_ROW_LIMIT + 1,
        })
        const truncated = rowsPlus.length > SHADOW_REPORT_ROW_LIMIT
        const rows = truncated ? rowsPlus.slice(0, SHADOW_REPORT_ROW_LIMIT) : rowsPlus
        return toolTextResult({
          temporary: true,
          window: { sinceHours, fromMs: sinceMs, toMs: nowMs, tenantId: tenantId ?? null },
          truncated,
          summary: summariseShadowRows(rows, { sample }),
          note: 'Sem rótulo humano, llm_only e differ não dizem quem tem razão: é a lista do que rever.',
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
