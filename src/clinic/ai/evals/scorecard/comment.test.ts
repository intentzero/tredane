/**
 * `scripts/scorecard-comment.mjs` — comentário do scorecard no PR (DEC-146).
 * O script é .mjs sem tipos (corre no CI só com Node): carrega-se dinamicamente.
 */
import { describe, expect, it } from 'vitest'

type Mod = {
  MARKER: string
  coverageNote: (changed: string[]) => { behaviour: string[]; touchedEvals: boolean }
  buildComment: (input: {
    latest: unknown
    comparison: unknown
    changed: string[]
    runFailed?: boolean
  }) => string
}

// @ts-expect-error -- ficheiro .mjs sem declaração de tipos
const load = (): Promise<Mod> => import('../../../../../scripts/scorecard-comment.mjs')

const kpis = {
  casesPassed: 112,
  casesExecuted: 112,
  casesKnownFailure: 1,
  casesPending: 2,
  casesCovered: 9,
  invViolations: 0,
  successRate: 1,
  excessTurnsP50: 0,
  excessTurnsP90: 0,
  multiQuestionPct: 0.03,
  concisePct: 1,
  bookingMatchRate: 0.8,
}
const latest = { kpis }
const cmp = (over: Record<string, unknown> = {}) => ({
  verdict: 'igual',
  regressions: [],
  progressions: [],
  fingerprintChanges: [],
  ...over,
})

describe('comentário do scorecard no PR', () => {
  it('leva o marcador (para atualizar o mesmo comentário) e diz que não bloqueia', async () => {
    const m = await load()
    const body = m.buildComment({ latest, comparison: cmp(), changed: [] })
    expect(body.startsWith(m.MARKER)).toBe(true)
    expect(body).toContain('Sem mudança')
    expect(body).toContain('não bloqueia o merge')
    expect(body).toContain('112/112')
  })

  it('lista regressões e marca as de gate', async () => {
    const m = await load()
    const body = m.buildComment({
      latest,
      comparison: cmp({
        verdict: 'bloqueia',
        regressions: [
          { key: 'A-01', before: 'pass', after: 'fail', gate: true },
          { key: 'turnsToConfirmP50', before: 1, after: 2 },
        ],
      }),
      changed: [],
    })
    expect(body).toContain('Bloqueia')
    expect(body).toContain('⛔ `A-01`')
    expect(body).toContain('`turnsToConfirmP50`')
  })

  it('mostra os fingerprints alterados e abrevia as progressões', async () => {
    const m = await load()
    const progressions = Array.from({ length: 12 }, (_, i) => ({ key: `X-${i}`, before: null, after: 'pass' }))
    const body = m.buildComment({
      latest,
      comparison: cmp({ verdict: 'melhoria', progressions, fingerprintChanges: ['promptPainel'] }),
      changed: [],
    })
    expect(body).toContain('Progressões (12)')
    expect(body).toContain('e mais 4')
    expect(body).toContain('`promptPainel`')
  })

  it('avisa quando o PR muda comportamento sem caso L1 novo', async () => {
    const m = await load()
    const none = m.buildComment({ latest, comparison: cmp(), changed: ['src/clinic/ai/autobook.ts', 'src/clinic/ai/autobook.test.ts'] })
    expect(none).toContain('Sem caso L1 novo')
    expect(none).toContain('src/clinic/ai/autobook.ts')
    const withCase = m.buildComment({
      latest,
      comparison: cmp(),
      changed: ['src/clinic/ai/autobook.ts', 'src/clinic/ai/evals/dialogs/p0-cases.ts'],
    })
    expect(withCase).not.toContain('Sem caso L1 novo')
  })

  it('não avisa por mudanças só de testes, do harness ou fora das pastas conversacionais', async () => {
    const m = await load()
    expect(m.coverageNote(['src/clinic/ai/autobook.test.ts']).behaviour).toEqual([])
    expect(m.coverageNote(['src/clinic/inbox/messages.ts', 'docs/x.md']).behaviour).toEqual([])
    expect(m.coverageNote(['src/whatsapp/flow/screens.ts']).behaviour).toEqual(['src/whatsapp/flow/screens.ts'])
  })

  it('diz com o que comparou: corrida da base ou linha de base gravada (que pode estar atrasada)', async () => {
    const m = await load()
    const fromBase = m.buildComment({
      latest,
      comparison: cmp({ baselineSource: 'base', baselineCommit: '99e698c1234+dirty' }),
      changed: [],
    })
    expect(fromBase).toContain('corrida da branch base')
    expect(fromBase).toContain('`99e698c`')
    expect(fromBase).not.toContain('+dirty')
    const recorded = m.buildComment({
      latest,
      comparison: cmp({ baselineSource: 'gravada', baselineCommit: '509afc8aaaa' }),
      changed: [],
    })
    expect(recorded).toContain('linha de base gravada')
    expect(recorded).toContain('pode estar atrás')
  })

  it('sem resultado do scorecard, diz-o em vez de inventar números', async () => {
    const m = await load()
    const body = m.buildComment({ latest: null, comparison: null, changed: [], runFailed: true })
    expect(body).toContain('não produziu resultado')
    expect(body).toContain('não bloqueia')
  })

  it('sem linha de base, diz que não há com que comparar', async () => {
    const m = await load()
    expect(m.buildComment({ latest, comparison: null, changed: [] })).toContain('Sem linha de base')
  })
})
