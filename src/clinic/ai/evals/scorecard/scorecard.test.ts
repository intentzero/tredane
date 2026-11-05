import { describe, expect, it } from 'vitest'
import {
  buildScorecard,
  compareScorecards,
  countQuestions,
  familyOf,
  isConcise,
  type CaseScore,
} from './scorecard'
import { correctJudgeRate, passHatK, passHatKCase, wilson } from './stats'

const base = (over: Partial<CaseScore> = {}): CaseScore => ({
  id: 'A-01',
  family: 'A',
  status: 'pass',
  invFailed: [],
  turnosIdeais: 2,
  agentTurns: 2,
  excessTurns: 0,
  outboundCount: 2,
  multiQuestionMessages: 0,
  conciseMessages: 2,
  damage: null,
  ...over,
})

const card = (cases: CaseScore[], commit = 'aaa') =>
  buildScorecard({ cases, version: { commit, fingerprints: {} }, recordedAt: '2026-11-05T00:00:00Z' })

describe('scorecard — medição', () => {
  it('conta perguntas e ignora URLs', () => {
    expect(countQuestions('Qual dia? E a hora?')).toBe(2)
    expect(countQuestions('Veja https://x.y/?a=1 ok?')).toBe(1)
  })
  it('concisão ≤300 caracteres e ≤3 parágrafos', () => {
    expect(isConcise('curta')).toBe(true)
    expect(isConcise('a'.repeat(301))).toBe(false)
    expect(isConcise('a\n\nb\n\nc\n\nd')).toBe(false)
  })
  it('família pela letra do ID', () => {
    expect(familyOf('A-13')).toBe('A')
    expect(familyOf('FL-02')).toBe('FL')
  })
  it('KPIs só contam executados no sucesso e nos turnos', () => {
    const k = card([
      base(),
      base({ id: 'A-02', status: 'covered', excessTurns: null }),
      base({ id: 'B-01', family: 'B', excessTurns: 2, agentTurns: 4 }),
    ]).kpis
    expect(k.casesExecuted).toBe(2)
    expect(k.successRate).toBe(1)
    expect(k.executedRatio).toBeCloseTo(2 / 3, 3)
    expect(k.excessTurnsP90).toBe(2)
    expect(k.executedByFamily).toEqual({ A: 1, B: 1 })
  })
})

describe('scorecard — comparação com a linha de base', () => {
  it('igual quando nada muda', () => {
    expect(compareScorecards(card([base()]), card([base()], 'bbb')).verdict).toBe('igual')
  })
  it('caso que passa a falhar bloqueia', () => {
    const cmp = compareScorecards(card([base()]), card([base({ status: 'fail' })]))
    expect(cmp.verdict).toBe('bloqueia')
  })
  it('nova invariante falhada bloqueia', () => {
    const cmp = compareScorecards(card([base()]), card([base({ invFailed: ['INV-02'] })]))
    expect(cmp.verdict).toBe('bloqueia')
  })
  it('mais turnos é regressão informativa, menos é progressão', () => {
    const worse = compareScorecards(card([base()]), card([base({ excessTurns: 1, agentTurns: 3 })]))
    expect(worse.verdict).toBe('regressao')
    expect(worse.regressions.map((c) => c.key)).toContain('A-01:turnos')
    const better = compareScorecards(card([base({ excessTurns: 1 })]), card([base()]))
    expect(better.verdict).toBe('melhoria')
  })
  it('caso removido é regressão de cobertura; caso novo é progressão', () => {
    const removed = compareScorecards(card([base(), base({ id: 'A-02' })]), card([base()]))
    expect(removed.regressions.some((c) => c.kind === 'removed' && c.key === 'A-02')).toBe(true)
    const added = compareScorecards(card([base()]), card([base(), base({ id: 'FL-01', family: 'FL' })]))
    expect(added.verdict).toBe('melhoria')
  })
  it('estrago: proposta deixa de bater com o pedido', () => {
    const d = { bookingMatchesRequest: true, zonesKeptRatio: 1, clientCorrections: 0, turnsToConfirm: 2 }
    const cmp = compareScorecards(
      card([base({ damage: d })]),
      card([base({ damage: { ...d, bookingMatchesRequest: false } })]),
    )
    expect(cmp.regressions.map((c) => c.key)).toContain('A-01:estrago')
  })
})

describe('estatística', () => {
  it('pass^k: estimador C(c,k)/C(n,k)', () => {
    expect(passHatKCase(3, 3, 3)).toBe(1)
    expect(passHatKCase(3, 2, 3)).toBe(0)
    expect(passHatKCase(4, 3, 2)).toBeCloseTo(3 / 6, 6)
    expect(passHatKCase(2, 2, 3)).toBeNull()
    expect(passHatK([{ n: 3, c: 3 }, { n: 3, c: 1 }], 1)).toBeCloseTo((1 + 1 / 3) / 2, 6)
  })
  it('Wilson contém a proporção e respeita [0,1]', () => {
    const ci = wilson(10, 10)!
    expect(ci.high).toBe(1)
    expect(ci.low).toBeGreaterThan(0.6)
    expect(ci.low).toBeLessThan(0.75)
    expect(wilson(0, 0)).toBeNull()
  })
  it('Rogan-Gladen corrige a taxa do juiz e recusa juiz inútil', () => {
    expect(correctJudgeRate(0.5, 1, 1)).toBe(0.5)
    expect(correctJudgeRate(0.9, 0.95, 0.6)).toBeCloseTo((0.9 + 0.6 - 1) / 0.55, 6)
    expect(correctJudgeRate(0.5, 0.5, 0.5)).toBeNull()
  })
})
