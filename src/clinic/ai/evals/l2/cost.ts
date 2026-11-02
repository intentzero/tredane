/**
 * Contabilidade de custo L2/L3 (#417 · DEC-117 · DEC-126).
 * Taxas **Propostas** a partir da tabela Anthropic (platform.claude.com/docs, nov/2026).
 * O teto de aplicação é transacional neste ledger; o limite do AI Gateway pode
 * ser eventualmente consistente — por isso paramos aqui, não só no gateway.
 */

export const L2_BUDGET_USD = 10
export const L3_BUDGET_USD = 10

/** USD por milhão de tokens (entrada / saída). */
export type ModelRate = { inputPerMTok: number; outputPerMTok: number }

/**
 * Mapa dos IDs usados no Tredane → taxa de lista Anthropic.
 * Desconhecido: trata como Sonnet 5.5 (conservador).
 */
export const MODEL_RATES_USD: Record<string, ModelRate> = {
  'claude-haiku-5-5': { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-sonnet-4-5': { inputPerMTok: 3, outputPerMTok: 15 },
}

const FALLBACK_RATE: ModelRate = MODEL_RATES_USD['claude-sonnet-5-5']!

export type TokenUsage = {
  model: string
  inputTokens: number
  outputTokens: number
  /** agent | judge | simulated_client */
  role: 'agent' | 'judge' | 'simulated_client'
  caseId?: string
  repetition?: number
}

export type CostEntry = TokenUsage & {
  usd: number
  atMs: number
}

export function rateForModel(model: string): ModelRate {
  const bare = model.replace(/^anthropic\//, '').replace(/^synthetic\//, '')
  return MODEL_RATES_USD[bare] ?? FALLBACK_RATE
}

export function costUsd(usage: {
  model: string
  inputTokens: number
  outputTokens: number
}): number {
  const rate = rateForModel(usage.model)
  return (usage.inputTokens / 1_000_000) * rate.inputPerMTok + (usage.outputTokens / 1_000_000) * rate.outputPerMTok
}

export class CostLedger {
  readonly ceilingUsd: number
  readonly label: string
  #entries: CostEntry[] = []
  #stopped = false
  #stopReason: string | null = null

  constructor(ceilingUsd: number, label: 'L2' | 'L3' | string = 'L2') {
    this.ceilingUsd = ceilingUsd
    this.label = label
  }

  get spentUsd(): number {
    return this.#entries.reduce((s, e) => s + e.usd, 0)
  }

  get remainingUsd(): number {
    return Math.max(0, this.ceilingUsd - this.spentUsd)
  }

  get truncated(): boolean {
    return this.#stopped
  }

  get stopReason(): string | null {
    return this.#stopReason
  }

  get entries(): readonly CostEntry[] {
    return this.#entries
  }

  /** Pode pagar `estimateUsd` sem ultrapassar o teto? */
  canAfford(estimateUsd: number): boolean {
    if (this.#stopped) return false
    return this.spentUsd + estimateUsd <= this.ceilingUsd + 1e-12
  }

  /**
   * Regista uso. Se o gasto acumulado atingir ou ultrapassar o teto,
   * marca truncado (a chamada já feita conta; as seguintes param).
   */
  record(usage: TokenUsage, atMs = Date.now()): CostEntry {
    const usd = costUsd(usage)
    const entry: CostEntry = { ...usage, usd, atMs }
    this.#entries.push(entry)
    if (this.spentUsd >= this.ceilingUsd) {
      this.#stopped = true
      this.#stopReason = `${this.label} atingiu o teto de US$ ${this.ceilingUsd.toFixed(2)} (gasto US$ ${this.spentUsd.toFixed(4)})`
    }
    return entry
  }

  /** Força parada (ex.: sem credenciais a meio, ou orçamento preventivo). */
  stop(reason: string): void {
    this.#stopped = true
    this.#stopReason = reason
  }

  summary(): {
    label: string
    ceilingUsd: number
    spentUsd: number
    remainingUsd: number
    truncated: boolean
    stopReason: string | null
    calls: number
    inputTokens: number
    outputTokens: number
    byRole: Record<string, { calls: number; usd: number; inputTokens: number; outputTokens: number }>
  } {
    const byRole: Record<string, { calls: number; usd: number; inputTokens: number; outputTokens: number }> = {}
    let inputTokens = 0
    let outputTokens = 0
    for (const e of this.#entries) {
      inputTokens += e.inputTokens
      outputTokens += e.outputTokens
      const bucket = byRole[e.role] ?? { calls: 0, usd: 0, inputTokens: 0, outputTokens: 0 }
      bucket.calls += 1
      bucket.usd += e.usd
      bucket.inputTokens += e.inputTokens
      bucket.outputTokens += e.outputTokens
      byRole[e.role] = bucket
    }
    return {
      label: this.label,
      ceilingUsd: this.ceilingUsd,
      spentUsd: this.spentUsd,
      remainingUsd: this.remainingUsd,
      truncated: this.truncated,
      stopReason: this.#stopReason,
      calls: this.#entries.length,
      inputTokens,
      outputTokens,
      byRole,
    }
  }
}

/** Estimativa conservadora para decidir se cabe mais um diálogo + juiz. */
export function estimateDialogRepUsd(opts: {
  agentCalls?: number
  judgeCalls?: number
  avgInput?: number
  avgOutput?: number
  agentModel?: string
  judgeModel?: string
} = {}): number {
  const agentCalls = opts.agentCalls ?? 1
  const judgeCalls = opts.judgeCalls ?? 1
  const avgIn = opts.avgInput ?? 2_500
  const avgOut = opts.avgOutput ?? 200
  const agentModel = opts.agentModel ?? 'claude-haiku-5-5'
  const judgeModel = opts.judgeModel ?? 'claude-haiku-5-5'
  return (
    agentCalls * costUsd({ model: agentModel, inputTokens: avgIn, outputTokens: avgOut }) +
    judgeCalls * costUsd({ model: judgeModel, inputTokens: 1_200, outputTokens: 250 })
  )
}
