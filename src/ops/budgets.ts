/**
 * Orçamentos e limites operacionais do piloto (#44).
 * Números abaixo são **Propostos** (não medidos em conta Cloudflare live).
 * Não inventar preços de lista Cloudflare/Meta/Clerk — só targets de engenharia.
 */

export type OpsBudgetStatus = 'proposto' | 'medido' | 'em_aberto'

export type OpsBudget = {
  id: string
  label: string
  /** Valor alvo proposto (unidade no campo unit). */
  proposed: number
  unit: string
  status: OpsBudgetStatus
  /** Como validar antes do go-live. */
  validation: string
  notes?: string
}

/**
 * Targets internos para alertas e revisão de produto.
 * Substituir por valores medidos em staging quando GATE de conta Cloudflare abrir.
 */
export const PROPOSED_OPS_BUDGETS: readonly OpsBudget[] = [
  {
    id: 'latency.api.p95_ms',
    label: 'Latência p95 API autenticada (sem Meta/Pix externos)',
    proposed: 400,
    unit: 'ms',
    status: 'proposto',
    validation: 'scripts/ops-synthetic-load.mjs + harness /api/f6/ops/load',
  },
  {
    id: 'latency.do.ping_p95_ms',
    label: 'Latência p95 ping Clinic DO',
    proposed: 150,
    unit: 'ms',
    status: 'proposto',
    validation: 'harness runtime + /api/f0/clinic/:id/ping',
  },
  {
    id: 'latency.ws.resume_p95_ms',
    label: 'Retoma WebSocket após hibernação (p95)',
    proposed: 1000,
    unit: 'ms',
    status: 'proposto',
    validation: 'ensaio JRN-07 / AC-12 em staging',
  },
  {
    id: 'storage.do.sqlite_mb_per_clinic',
    label: 'SQLite por clínica (piloto ~90 dias sintéticos)',
    proposed: 200,
    unit: 'MiB',
    status: 'proposto',
    validation: 'snapshot ops no DO após carga sintética; limite CF a conferir na doc vigente',
    notes: 'Não confundir com quota global da conta.',
  },
  {
    id: 'queue.inbound.lag_s',
    label: 'Atraso máximo aceite na fila inbound (sem DLQ)',
    proposed: 60,
    unit: 's',
    status: 'proposto',
    validation: 'métricas Queues em staging + alert dlq.depth',
  },
  {
    id: 'ws.connections_per_clinic',
    label: 'Conexões WebSocket simultâneas por clínica (piloto)',
    proposed: 20,
    unit: 'connections',
    status: 'proposto',
    validation: 'contagem no DO + ensaio com 2–N abas',
  },
  {
    id: 'cost.clinic_month_relative',
    label: 'Custo relativo por clínica / mês (índice, não moeda)',
    proposed: 1,
    unit: 'index',
    status: 'em_aberto',
    validation:
      'Somar Workers/DO/D1/R2/Queues + Clerk MAU + Meta conversas + Pix taxas + AI tokens após GATE-05/08/09; não inventar preços',
  },
] as const

export function getBudget(id: string): OpsBudget | undefined {
  return PROPOSED_OPS_BUDGETS.find((b) => b.id === id)
}

export type LatencySample = {
  name: string
  durationsMs: number[]
}

export type LatencySummary = {
  name: string
  count: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  withinProposedP95: boolean | null
  proposedP95Ms: number | null
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  )
  return sorted[idx]!
}

export function summarizeLatency(sample: LatencySample): LatencySummary {
  const sorted = [...sample.durationsMs].sort((a, b) => a - b)
  const p95 = percentile(sorted, 95)
  const budget =
    sample.name === 'do.ping'
      ? getBudget('latency.do.ping_p95_ms')
      : sample.name.startsWith('api.')
        ? getBudget('latency.api.p95_ms')
        : undefined
  const proposed = budget?.proposed ?? null
  return {
    name: sample.name,
    count: sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: p95,
    maxMs: sorted.length ? sorted[sorted.length - 1]! : 0,
    withinProposedP95: proposed == null ? null : p95 <= proposed,
    proposedP95Ms: proposed,
  }
}
