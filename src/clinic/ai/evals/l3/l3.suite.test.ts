/**
 * Dry-run L3 no CI — personas P-01/P-06/P-10, sem gateway (#417 · DEC-126).
 */
import { describe, expect, it } from 'vitest'
import { L3_PERSONAS } from './personas'
import { formatL3Report, runL3Suite } from './runner'

describe('harness L3 dry-run (#417 · DEC-126)', () => {
  it('regista as 10 personas da matriz §P', () => {
    expect(L3_PERSONAS).toHaveLength(10)
    expect(L3_PERSONAS.map((p) => p.id)).toEqual([
      'P-01',
      'P-02',
      'P-03',
      'P-04',
      'P-05',
      'P-06',
      'P-07',
      'P-08',
      'P-09',
      'P-10',
    ])
  })

  it(
    'corre amostra P-01, P-06, P-10 abaixo do teto',
    async () => {
      const report = await runL3Suite({
        mode: 'dry-run',
        personaIds: ['P-01', 'P-06', 'P-10'],
        withJudge: true,
      })
      expect(report.mode).toBe('dry-run')
      expect(report.complete).toBe(true)
      expect(report.truncated).toBe(false)
      expect(report.budget.ceilingUsd).toBe(10)
      expect(report.personasRun).toEqual(['P-01', 'P-06', 'P-10'])
      for (const r of report.results) {
        expect(r.clientTurns.length).toBeGreaterThan(0)
        expect(r.outbound.length).toBeGreaterThan(0)
        expect(r.ok).toBe(true)
        expect(r.truncated).toBe(false)
        expect(r.invariantsFailed).not.toContain('INV-01')
        expect(r.invariantsFailed).not.toContain('INV-11')
        expect(r.judge?.mean).toBe(2)
      }
      expect(formatL3Report(report)).toMatch(/COMPLETA/)
    },
    90_000,
  )

  it('trunca com teto impossível e não marca completa', async () => {
    const report = await runL3Suite({
      mode: 'dry-run',
      personaIds: ['P-01', 'P-02', 'P-03'],
      budgetUsd: 1e-12,
    })
    expect(report.truncated).toBe(true)
    expect(report.complete).toBe(false)
    expect(report.note).toMatch(/TRUNCADA/i)
  })
})
