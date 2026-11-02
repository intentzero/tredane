/**
 * Dry-run do harness L2 no CI — sem gateway, sem custo real (#417).
 * Não enfraquece L1: este ficheiro é independente de dialogs.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { formatL2Report, runL2Suite } from './runner'

describe('harness L2 dry-run (#417 · DEC-117)', () => {
  it(
    'corre subconjunto com N=2, juiz dry-run, abaixo do teto e sem truncar',
    async () => {
      const report = await runL2Suite({
        mode: 'dry-run',
        n: 2,
        caseIds: ['A-01', 'G-01', 'H-04'],
        withJudge: true,
        commit: 'test',
      })
      expect(report.mode).toBe('dry-run')
      expect(report.complete).toBe(true)
      expect(report.truncated).toBe(false)
      expect(report.budget.ceilingUsd).toBe(10)
      expect(report.budget.spentUsd).toBeLessThan(10)
      expect(report.casesRun).toEqual(['A-01', 'G-01', 'H-04'])
      expect(report.casesSkipped).toEqual([])
      for (const r of report.results) {
        expect(r.repetitions).toHaveLength(2)
        for (const rep of r.repetitions) {
          expect(rep.judge).not.toBeNull()
          expect(rep.judge!.mean).toBe(2)
          expect(rep.ee.ee05.messages.length).toBe(rep.dialog.outbound.length)
        }
      }
      const text = formatL2Report(report)
      expect(text).toMatch(/COMPLETA/)
      expect(text).toMatch(/US\$/)
    },
    60_000,
  )

  it('trunca e NÃO marca completa quando o teto é minúsculo', async () => {
    const report = await runL2Suite({
      mode: 'dry-run',
      n: 3,
      caseIds: ['A-01', 'A-02', 'B-01', 'C-01', 'G-01'],
      budgetUsd: 1e-12,
      withJudge: false,
      estimatePerRepUsd: 1,
      commit: 'test-trunc',
    })
    expect(report.truncated).toBe(true)
    expect(report.complete).toBe(false)
    expect(report.note).toMatch(/TRUNCADA/i)
    expect(report.casesSkipped.length + (report.casesRun.length < 5 ? 1 : 0)).toBeGreaterThan(0)
  })
})
