/**
 * Adaptador que envolve outro e regista tokens/latência no CostLedger (#417).
 */
import type { AiProviderAdapter } from '../../../../ai'
import type { AiGenerateInput, AiGenerateResult, AiGatewayRequestInspection } from '../../../../ai'
import type { CostLedger } from './cost'

export type TrackingCall = {
  ok: boolean
  model: string
  latencyMs: number
  inputTokens: number
  outputTokens: number
  role: 'agent' | 'judge' | 'simulated_client'
  caseId?: string
  repetition?: number
}

export class TrackingAiAdapter implements AiProviderAdapter {
  readonly providerId: string
  readonly mode: 'synthetic' | 'gateway'

  #inner: AiProviderAdapter
  #ledger: CostLedger
  #role: TrackingCall['role']
  #caseId?: string
  #repetition?: number
  #calls: TrackingCall[] = []
  /** Quando true, generate falha se o ledger já truncou. */
  #enforceBudget: boolean

  constructor(
    inner: AiProviderAdapter,
    ledger: CostLedger,
    opts: {
      role?: TrackingCall['role']
      enforceBudget?: boolean
    } = {},
  ) {
    this.#inner = inner
    this.#ledger = ledger
    this.providerId = inner.providerId
    this.mode = inner.mode
    this.#role = opts.role ?? 'agent'
    this.#enforceBudget = opts.enforceBudget !== false
  }

  setContext(ctx: { caseId?: string; repetition?: number; role?: TrackingCall['role'] }): void {
    this.#caseId = ctx.caseId
    this.#repetition = ctx.repetition
    if (ctx.role) this.#role = ctx.role
  }

  get calls(): readonly TrackingCall[] {
    return this.#calls
  }

  lastInspection(): AiGatewayRequestInspection | null {
    return this.#inner.lastInspection()
  }

  async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    if (this.#enforceBudget && this.#ledger.truncated) {
      return {
        ok: false,
        code: 'budget_exceeded',
        message: this.#ledger.stopReason ?? 'orçamento L2/L3 esgotado',
        retryable: false,
        latencyMs: 0,
        provider: this.providerId,
        model: input.model ?? 'unknown',
      }
    }

    const result = await this.#inner.generate(input)
    const inputTokens = result.ok ? (result.inputTokens ?? 0) : 0
    const outputTokens = result.ok ? (result.outputTokens ?? 0) : 0
    const model = result.model

    if (result.ok || inputTokens > 0 || outputTokens > 0) {
      this.#ledger.record({
        model,
        inputTokens,
        outputTokens,
        role: this.#role,
        caseId: this.#caseId,
        repetition: this.#repetition,
      })
    }

    this.#calls.push({
      ok: result.ok,
      model,
      latencyMs: result.latencyMs,
      inputTokens,
      outputTokens,
      role: this.#role,
      caseId: this.#caseId,
      repetition: this.#repetition,
    })

    return result
  }
}
