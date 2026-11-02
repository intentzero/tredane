import { describe, expect, it } from 'vitest'
import { cohenKappa, runJudge } from './judge'
import { CostLedger } from './cost'
import { SimulatedAiAdapter } from '../../../../ai'

describe('juiz Q1–Q6 (#417)', () => {
  it('dry-run devolve scores 2 sem gastar tokens', async () => {
    const ledger = new CostLedger(10, 'L2')
    const r = await runJudge({
      adapter: new SimulatedAiAdapter(),
      ledger,
      dryRun: true,
      input: { caseId: 'A-01', clientTurns: ['oi'], agentOutbound: ['Olá!'] },
    })
    expect(r.abstained).toBe(false)
    expect(r.mean).toBe(2)
    expect(r.scores).toHaveLength(6)
    expect(ledger.spentUsd).toBe(0)
  })

  it('cohenKappa perfeito = 1; desacordo total ≈ negativo ou baixo', () => {
    expect(cohenKappa([2, 2, 1], [2, 2, 1])).toBe(1)
    expect(cohenKappa([0, 0, 0], [2, 2, 2])).toBeLessThan(0.1)
    expect(cohenKappa([], [])).toBeNull()
  })
})
