/**
 * Ponte L1 → scorecard: converte o resultado de cada caso em `CaseScore`
 * e trata a gravação/comparação pedida por variáveis de ambiente.
 *
 *   EVAL_SCORECARD=1          grava `.eval/l1-latest.json` e compara com a linha de base
 *   EVAL_SCORECARD_RECORD=1   além disso, substitui a linha de base e acrescenta ao histórico
 *   EVAL_STRICT=1             falha também em regressão informativa (não só em gate)
 *   EVAL_BASELINE_PATH=ficheiro   compara com outro scorecard (o CI usa uma corrida da `main`,
 *                             para a comparação não atribuir ao PR os casos que outros
 *                             acrescentaram depois da linha de base gravada). Só compara.
 *
 * Sem variáveis, nada é escrito (CI normal intacto).
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DialogCase, DialogRunResult } from '../dialogs/runner'
import {
  buildScorecard,
  compareScorecards,
  countQuestions,
  familyOf,
  formatComparison,
  formatKpis,
  isConcise,
  type CaseScore,
  type Comparison,
  type Scorecard,
} from './scorecard'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(here, '../../../../..')
export const BASELINE_PATH = resolve(REPO_ROOT, 'docs/implementation/avaliacao/l1-baseline.json')
export const HISTORY_PATH = resolve(REPO_ROOT, 'docs/implementation/avaliacao/l1-history.jsonl')
export const LATEST_PATH = resolve(REPO_ROOT, '.eval/l1-latest.json')
/** Comparação com a linha de base (JSON), lida por `scripts/scorecard-comment.mjs` no CI. */
export const COMPARISON_PATH = resolve(REPO_ROOT, '.eval/l1-comparison.json')

/** Ficheiros cujo hash identifica a versão do comportamento além do commit. */
const FINGERPRINT_FILES: Record<string, string> = {
  catalogoRef: 'src/clinic/ai/evals/dialogs/scenario.ts',
  casos: 'src/clinic/ai/evals/dialogs/p0-cases.ts',
  casosFlow: 'src/clinic/ai/evals/dialogs/fl-cases.ts',
  casosConsulta: 'src/clinic/ai/evals/dialogs/cc-cases.ts',
  casosZonas: 'src/clinic/ai/evals/dialogs/zonas-cases.ts',
  promptPainel: 'src/ai/prompt.ts',
  promptExtrator: 'src/ai/extractor-prompt.ts',
  promptExcecao: 'src/ai/exception-prompt.ts',
  atosDialogo: 'src/clinic/ai/dialogue-acts.ts',
  consultaCatalogo: 'src/clinic/ai/catalog-consult.ts',
}

export function caseScoreFromL1(c: DialogCase, r: DialogRunResult): CaseScore {
  const status = r.status ?? (r.ok ? 'pass' : 'fail')
  const executed = status === 'pass' || status === 'fail'
  return {
    id: c.id,
    family: familyOf(c.id),
    status,
    invFailed: r.invariants.filter((i) => !i.ok).map((i) => i.id).sort(),
    turnosIdeais: c.turnosIdeais,
    agentTurns: r.agentTurns,
    excessTurns: executed ? r.agentTurns - c.turnosIdeais : null,
    outboundCount: r.outbound.length,
    multiQuestionMessages: r.outbound.filter((b) => countQuestions(b) > 1).length,
    conciseMessages: r.outbound.filter(isConcise).length,
    damage: r.damage
      ? {
          bookingMatchesRequest: r.damage.bookingMatchesRequest,
          zonesKeptRatio: r.damage.zonesKeptRatio,
          clientCorrections: r.damage.clientCorrections,
          turnsToConfirm: r.damage.turnsToConfirm,
        }
      : null,
  }
}

function sha256(path: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(resolve(REPO_ROOT, path))).digest('hex')
  } catch {
    return null
  }
}

function gitCommit(): string {
  try {
    const sha = execSync('git rev-parse HEAD', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return dirty ? `${sha}+dirty` : sha
  } catch {
    return 'unknown'
  }
}

export type ScorecardOutcome = { scorecard: Scorecard; comparison: Comparison | null; report: string }

/** Constrói, grava e compara conforme o ambiente. Devolve null se desligado. */
export function emitL1Scorecard(
  pairs: Array<{ c: DialogCase; r: DialogRunResult }>,
  env: NodeJS.ProcessEnv = process.env,
  /** Nº de casos registados: gravar a linha de base exige a corrida completa. */
  expectedTotal?: number,
): ScorecardOutcome | null {
  const record = env.EVAL_SCORECARD_RECORD === '1'
  if (env.EVAL_SCORECARD !== '1' && !record) return null

  const scorecard = buildScorecard({
    cases: pairs.map(({ c, r }) => caseScoreFromL1(c, r)),
    version: {
      commit: gitCommit(),
      fingerprints: Object.fromEntries(Object.entries(FINGERPRINT_FILES).map(([k, p]) => [k, sha256(p)])),
    },
    recordedAt: new Date().toISOString(),
  })

  mkdirSync(dirname(LATEST_PATH), { recursive: true })
  writeFileSync(LATEST_PATH, `${JSON.stringify(scorecard, null, 2)}\n`)

  let comparison: Comparison | null = null
  const parts = ['', '══ Scorecard L1 ══', formatKpis(scorecard.kpis)]
  const override = env.EVAL_BASELINE_PATH ? resolve(process.cwd(), env.EVAL_BASELINE_PATH) : null
  const useOverride = override != null && existsSync(override)
  const comparePath = useOverride ? override : BASELINE_PATH
  if (existsSync(comparePath)) {
    const baseline = JSON.parse(readFileSync(comparePath, 'utf8')) as Scorecard
    comparison = compareScorecards(baseline, scorecard)
    writeFileSync(
      COMPARISON_PATH,
      `${JSON.stringify({ ...comparison, baselineSource: useOverride ? 'base' : 'gravada' }, null, 2)}\n`,
    )
    parts.push('', formatComparison(comparison))
  } else {
    parts.push('', 'Sem linha de base: corra `npm run eval:baseline` para a criar.')
  }

  // A linha de base é «a última versão aceite»: nunca grava uma corrida parcial,
  // com casos a falhar ou com regressão em gate (senão aprovava a própria regressão).
  const refusal = record
    ? useOverride
      ? 'EVAL_BASELINE_PATH está definido (serve só para comparar)'
      : recordRefusal(scorecard, comparison, expectedTotal)
    : null
  if (record && refusal) {
    parts.push('', `Linha de base NÃO atualizada: ${refusal}.`)
  } else if (record) {
    mkdirSync(dirname(BASELINE_PATH), { recursive: true })
    writeFileSync(BASELINE_PATH, `${JSON.stringify(scorecard, null, 2)}\n`)
    appendFileSync(
      HISTORY_PATH,
      `${JSON.stringify({
        recordedAt: scorecard.recordedAt,
        commit: scorecard.version.commit,
        verdict: comparison?.verdict ?? 'inicial',
        regressions: comparison?.regressions.map((c) => c.key) ?? [],
        progressions: comparison?.progressions.map((c) => c.key) ?? [],
        kpis: scorecard.kpis,
      })}\n`,
    )
    parts.push('', `Linha de base atualizada e histórico acrescentado (${HISTORY_PATH.replace(`${REPO_ROOT}/`, '')}).`)
  }

  return { scorecard, comparison, report: parts.join('\n') }
}

function recordRefusal(
  scorecard: Scorecard,
  comparison: Comparison | null,
  expectedTotal?: number,
): string | null {
  if (expectedTotal != null && scorecard.cases.length < expectedTotal) {
    return `corrida parcial (${scorecard.cases.length} de ${expectedTotal} casos)`
  }
  if (scorecard.kpis.casesFailed > 0) return `${scorecard.kpis.casesFailed} caso(s) a falhar`
  if (scorecard.kpis.invViolations > 0) return `${scorecard.kpis.invViolations} violação(ões) de invariante`
  if (comparison?.verdict === 'bloqueia') return 'regressão em gate'
  return null
}

/** Erro a lançar no teste, ou null. Gate sempre; regressão informativa só em EVAL_STRICT. */
export function scorecardFailure(out: ScorecardOutcome, env: NodeJS.ProcessEnv = process.env): string | null {
  const cmp = out.comparison
  if (!cmp) return null
  if (cmp.verdict === 'bloqueia') return 'Scorecard L1: regressão em gate (invariante ou caso a falhar)'
  if (env.EVAL_STRICT === '1' && cmp.verdict === 'regressao') return 'Scorecard L1: regressão (EVAL_STRICT=1)'
  return null
}
