import { describe, expect, it } from 'vitest'
import {
  CostLedger,
  L2_BUDGET_USD,
  L3_BUDGET_USD,
  costUsd,
  estimateDialogRepUsd,
  rateForModel,
} from './cost'

describe('L2/L3 cost ledger (#417)', () => {
  it('DEC-117 / DEC-126 tetos são US$ 10', () => {
    expect(L2_BUDGET_USD).toBe(10)
    expect(L3_BUDGET_USD).toBe(10)
  })

  it('calcula USD a partir de tokens Haiku 5.5', () => {
    // 1M in + 1M out = 0.1 + 0.5 = 0.6
    expect(costUsd({ model: 'claude-haiku-5-5', inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(
      0.6,
      6,
    )
    expect(rateForModel('anthropic/claude-haiku-5-5').inputPerMTok).toBe(0.1)
  })

  it('para ao atingir o teto e marca truncado', () => {
    const ledger = new CostLedger(0.0001, 'L2')
    expect(ledger.canAfford(0.00005)).toBe(true)
    ledger.record({
      model: 'claude-haiku-5-5',
      inputTokens: 2_000_000,
      outputTokens: 0,
      role: 'agent',
      caseId: 'A-01',
    })
    expect(ledger.truncated).toBe(true)
    expect(ledger.canAfford(0.00001)).toBe(false)
    expect(ledger.summary().spentUsd).toBeGreaterThan(0.0001)
  })

  it('estimateDialogRepUsd é positivo e pequeno para Haiku', () => {
    const e = estimateDialogRepUsd()
    expect(e).toBeGreaterThan(0)
    expect(e).toBeLessThan(0.05)
  })
})
