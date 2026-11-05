/**
 * Scorecard da avaliação conversacional (metodologia §4–§6).
 *
 * Transforma uma corrida L1 num registo comparável (JSON estável) e compara-o
 * com a linha de base guardada no repositório. Assinala, caso a caso e por KPI:
 * regressões, progressões, casos novos e casos que desapareceram.
 *
 * Funções puras: sem I/O. O teste L1 e o CLI fazem a leitura/escrita.
 * DEC-108: só as invariantes bloqueiam o merge; o resto é informativo até
 * decisão nova. `strict` existe para quando o Paulo promover KPIs a gate.
 */

export const SCORECARD_SCHEMA = 1

export type CaseStatus = 'pass' | 'known_failure' | 'pending' | 'covered' | 'fail'

export type CaseScore = {
  id: string
  /** Família da matriz (letra antes do hífen: A, B, …). */
  family: string
  status: CaseStatus
  /** Invariantes que falharam neste caso (vazio = todas passaram). */
  invFailed: string[]
  turnosIdeais: number
  agentTurns: number
  /** EE-01: turnos do agente − turnos ideais (só casos executados). */
  excessTurns: number | null
  outboundCount: number
  /** EE-03: mensagens com mais de uma pergunta. */
  multiQuestionMessages: number
  /** EE-05: mensagens dentro de ≤300 caracteres e ≤3 parágrafos. */
  conciseMessages: number
  /** ES-01 a ES-04 quando o caso declara `damage`. */
  damage: {
    bookingMatchesRequest: boolean | null
    zonesKeptRatio: number | null
    clientCorrections: number
    turnsToConfirm: number | null
  } | null
}

export type ScorecardVersion = {
  commit: string
  /** Hash do ficheiro do catálogo de referência e dos prompts, quando disponíveis. */
  fingerprints: Record<string, string | null>
}

export type Kpis = {
  casesTotal: number
  casesExecuted: number
  casesPassed: number
  casesFailed: number
  casesKnownFailure: number
  casesPending: number
  casesCovered: number
  /** K-INV: violações de invariantes somadas em todos os casos. Gate = 0. */
  invViolations: number
  /** K-SUC (EF-01): passam ÷ executados. */
  successRate: number | null
  /** K-COV: executados ÷ total registados. */
  executedRatio: number | null
  /** K-TURN (EE-01): mediana e p90 de turnos excedentes. */
  excessTurnsP50: number | null
  excessTurnsP90: number | null
  /** K-1Q (EE-03): % mensagens com >1 pergunta. */
  multiQuestionPct: number | null
  /** K-LEN (EE-05): % mensagens concisas. */
  concisePct: number | null
  /** K-DMG (ES-01): propostas iguais ao pedido ÷ casos com proposta julgável. */
  bookingMatchRate: number | null
  /** ES-02 médio. */
  zonesKeptMean: number | null
  /** ES-04: mediana de voltas até ao Confirmar. */
  turnsToConfirmP50: number | null
  /** Cobertura por família: casos executados por letra. */
  executedByFamily: Record<string, number>
}

export type Scorecard = {
  schema: typeof SCORECARD_SCHEMA
  level: 'L1'
  recordedAt: string
  version: ScorecardVersion
  kpis: Kpis
  cases: CaseScore[]
}

// ───────────────────────────── medição por mensagem

/** Conta perguntas reais (ignora «?» dentro de URLs). */
export function countQuestions(body: string): number {
  const noUrls = body.replace(/https?:\/\/\S+/g, '')
  return (noUrls.match(/\?/g) ?? []).length
}

export function isConcise(body: string): boolean {
  const paragraphs = body.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length || (body.trim() ? 1 : 0)
  return body.length <= 300 && paragraphs <= 3
}

export function familyOf(id: string): string {
  const m = /^([A-Z]+)\d*-/.exec(id)
  return m ? m[1]! : id.split('-')[0] ?? id
}

// ───────────────────────────── agregação

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))
  return s[idx]!
}

function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den
}

const round = (v: number | null, d = 4): number | null =>
  v == null ? null : Math.round(v * 10 ** d) / 10 ** d

export function computeKpis(cases: CaseScore[]): Kpis {
  const executed = cases.filter((c) => c.status === 'pass' || c.status === 'fail')
  const passed = cases.filter((c) => c.status === 'pass')
  const msgs = executed.reduce((n, c) => n + c.outboundCount, 0)
  const multi = executed.reduce((n, c) => n + c.multiQuestionMessages, 0)
  const concise = executed.reduce((n, c) => n + c.conciseMessages, 0)
  const excess = executed.map((c) => c.excessTurns).filter((v): v is number => v != null)
  const judged = cases.filter((c) => c.damage?.bookingMatchesRequest != null)
  const zones = cases.map((c) => c.damage?.zonesKeptRatio).filter((v): v is number => v != null)
  const toConfirm = cases.map((c) => c.damage?.turnsToConfirm).filter((v): v is number => v != null)
  const byFamily: Record<string, number> = {}
  for (const c of executed) byFamily[c.family] = (byFamily[c.family] ?? 0) + 1
  return {
    casesTotal: cases.length,
    casesExecuted: executed.length,
    casesPassed: passed.length,
    casesFailed: cases.filter((c) => c.status === 'fail').length,
    casesKnownFailure: cases.filter((c) => c.status === 'known_failure').length,
    casesPending: cases.filter((c) => c.status === 'pending').length,
    casesCovered: cases.filter((c) => c.status === 'covered').length,
    invViolations: cases.reduce((n, c) => n + c.invFailed.length, 0),
    successRate: round(ratio(passed.length, executed.length)),
    executedRatio: round(ratio(executed.length, cases.length)),
    excessTurnsP50: quantile(excess, 0.5),
    excessTurnsP90: quantile(excess, 0.9),
    multiQuestionPct: round(ratio(multi, msgs)),
    concisePct: round(ratio(concise, msgs)),
    bookingMatchRate: round(ratio(judged.filter((c) => c.damage!.bookingMatchesRequest).length, judged.length)),
    zonesKeptMean: round(zones.length ? zones.reduce((a, b) => a + b, 0) / zones.length : null),
    turnsToConfirmP50: quantile(toConfirm, 0.5),
    executedByFamily: Object.fromEntries(Object.entries(byFamily).sort(([a], [b]) => a.localeCompare(b))),
  }
}

export function buildScorecard(input: {
  cases: CaseScore[]
  version: ScorecardVersion
  recordedAt: string
}): Scorecard {
  const cases = [...input.cases].sort((a, b) => a.id.localeCompare(b.id))
  return {
    schema: SCORECARD_SCHEMA,
    level: 'L1',
    recordedAt: input.recordedAt,
    version: input.version,
    kpis: computeKpis(cases),
    cases,
  }
}

// ───────────────────────────── comparação com a linha de base

export type Direction = 'higher_better' | 'lower_better'

/**
 * KPIs comparados e tolerância antes de assinalar.
 * Tolerâncias **Propostas** (metodologia §5); mudar aqui e na tabela do doc.
 */
export const KPI_RULES: Array<{ key: keyof Kpis; dir: Direction; tolerance: number; gate?: boolean }> = [
  { key: 'invViolations', dir: 'lower_better', tolerance: 0, gate: true },
  { key: 'casesFailed', dir: 'lower_better', tolerance: 0, gate: true },
  { key: 'casesExecuted', dir: 'higher_better', tolerance: 0 },
  { key: 'successRate', dir: 'higher_better', tolerance: 0 },
  { key: 'excessTurnsP50', dir: 'lower_better', tolerance: 0 },
  { key: 'excessTurnsP90', dir: 'lower_better', tolerance: 0 },
  { key: 'multiQuestionPct', dir: 'lower_better', tolerance: 0.02 },
  { key: 'concisePct', dir: 'higher_better', tolerance: 0.02 },
  { key: 'bookingMatchRate', dir: 'higher_better', tolerance: 0 },
  { key: 'zonesKeptMean', dir: 'higher_better', tolerance: 0 },
  { key: 'turnsToConfirmP50', dir: 'lower_better', tolerance: 0 },
]

export type Change = {
  scope: 'kpi' | 'case'
  key: string
  kind: 'regression' | 'progression' | 'added' | 'removed' | 'changed'
  before: unknown
  after: unknown
  gate?: boolean
}

export type Comparison = {
  baselineCommit: string
  currentCommit: string
  changes: Change[]
  regressions: Change[]
  progressions: Change[]
  /** `bloqueia` só por gate (INV / caso a falhar); `regressao` = informativo. */
  verdict: 'bloqueia' | 'regressao' | 'melhoria' | 'igual'
}

const STATUS_RANK: Record<CaseStatus, number> = {
  fail: 0,
  known_failure: 1,
  pending: 2,
  covered: 3,
  pass: 4,
}

function compareNumber(
  before: number | null,
  after: number | null,
  dir: Direction,
  tolerance: number,
): Change['kind'] | null {
  if (before == null && after == null) return null
  if (before == null || after == null) return 'changed'
  const delta = after - before
  if (Math.abs(delta) <= tolerance) return null
  const better = dir === 'higher_better' ? delta > 0 : delta < 0
  return better ? 'progression' : 'regression'
}

export function compareScorecards(baseline: Scorecard, current: Scorecard): Comparison {
  const changes: Change[] = []

  for (const rule of KPI_RULES) {
    const b = baseline.kpis[rule.key] as number | null
    const a = current.kpis[rule.key] as number | null
    const kind = compareNumber(b, a, rule.dir, rule.tolerance)
    if (kind) changes.push({ scope: 'kpi', key: rule.key, kind, before: b, after: a, gate: rule.gate && kind === 'regression' })
  }

  const baseById = new Map(baseline.cases.map((c) => [c.id, c]))
  const curById = new Map(current.cases.map((c) => [c.id, c]))
  for (const [id, b] of baseById) {
    const a = curById.get(id)
    if (!a) {
      // Os casos nunca se apagam (plano §6): um ID que some é regressão de cobertura.
      changes.push({ scope: 'case', key: id, kind: 'removed', before: b.status, after: null })
      continue
    }
    if (a.status !== b.status) {
      const kind = STATUS_RANK[a.status] > STATUS_RANK[b.status] ? 'progression' : 'regression'
      changes.push({ scope: 'case', key: id, kind, before: b.status, after: a.status, gate: a.status === 'fail' })
    }
    const newInv = a.invFailed.filter((i) => !b.invFailed.includes(i))
    if (newInv.length) changes.push({ scope: 'case', key: `${id}:inv`, kind: 'regression', before: b.invFailed, after: a.invFailed, gate: true })
    if (a.excessTurns != null && b.excessTurns != null && a.excessTurns !== b.excessTurns) {
      changes.push({
        scope: 'case',
        key: `${id}:turnos`,
        kind: a.excessTurns > b.excessTurns ? 'regression' : 'progression',
        before: b.excessTurns,
        after: a.excessTurns,
      })
    }
    if (a.multiQuestionMessages !== b.multiQuestionMessages) {
      changes.push({
        scope: 'case',
        key: `${id}:multipergunta`,
        kind: a.multiQuestionMessages > b.multiQuestionMessages ? 'regression' : 'progression',
        before: b.multiQuestionMessages,
        after: a.multiQuestionMessages,
      })
    }
    const bm = b.damage?.bookingMatchesRequest
    const am = a.damage?.bookingMatchesRequest
    if (bm != null && am != null && bm !== am) {
      changes.push({ scope: 'case', key: `${id}:estrago`, kind: am ? 'progression' : 'regression', before: bm, after: am })
    }
  }
  for (const [id, a] of curById) {
    if (!baseById.has(id)) changes.push({ scope: 'case', key: id, kind: 'added', before: null, after: a.status })
  }

  const regressions = changes.filter((c) => c.kind === 'regression' || c.kind === 'removed')
  const progressions = changes.filter((c) => c.kind === 'progression' || c.kind === 'added')
  const verdict = regressions.some((c) => c.gate)
    ? 'bloqueia'
    : regressions.length
      ? 'regressao'
      : progressions.length
        ? 'melhoria'
        : 'igual'
  return {
    baselineCommit: baseline.version.commit,
    currentCommit: current.version.commit,
    changes,
    regressions,
    progressions,
    verdict,
  }
}

// ───────────────────────────── relatório

const fmt = (v: unknown): string => {
  if (v == null) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3)
  if (Array.isArray(v)) return v.length ? v.join(',') : '∅'
  return String(v)
}

const VERDICT_LABEL: Record<Comparison['verdict'], string> = {
  bloqueia: '⛔ BLOQUEIA (invariante ou caso a falhar)',
  regressao: '⚠ REGRESSÃO (informativa — DEC-108)',
  melhoria: '✅ MELHORIA',
  igual: '＝ SEM MUDANÇA',
}

export function formatKpis(k: Kpis): string {
  const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)} %`)
  return [
    `| KPI | Valor |`,
    `| --- | --- |`,
    `| K-INV violações de invariantes | ${k.invViolations} |`,
    `| K-SUC sucesso (passam ÷ executados) | ${k.casesPassed}/${k.casesExecuted} = ${pct(k.successRate)} |`,
    `| K-COV executados ÷ registados | ${k.casesExecuted}/${k.casesTotal} = ${pct(k.executedRatio)} (falhas conhecidas ${k.casesKnownFailure}, pendentes ${k.casesPending}, cobertos fora ${k.casesCovered}) |`,
    `| K-TURN turnos excedentes p50 / p90 | ${fmt(k.excessTurnsP50)} / ${fmt(k.excessTurnsP90)} |`,
    `| K-1Q mensagens com >1 pergunta | ${pct(k.multiQuestionPct)} |`,
    `| K-LEN mensagens concisas | ${pct(k.concisePct)} |`,
    `| K-DMG proposta = pedido | ${pct(k.bookingMatchRate)} · zonas mantidas ${pct(k.zonesKeptMean)} · voltas até Confirmar p50 ${fmt(k.turnsToConfirmP50)} |`,
    `| Cobertura por família | ${Object.entries(k.executedByFamily).map(([f, n]) => `${f}:${n}`).join(' ') || '—'} |`,
  ].join('\n')
}

export function formatComparison(cmp: Comparison): string {
  const lines = [
    `Comparação L1: linha de base ${cmp.baselineCommit.slice(0, 10)} → atual ${cmp.currentCommit.slice(0, 10)}`,
    `Veredicto: ${VERDICT_LABEL[cmp.verdict]}`,
  ]
  const section = (title: string, list: Change[]) => {
    if (!list.length) return
    lines.push('', `${title} (${list.length}):`)
    for (const c of list) {
      lines.push(`  ${c.gate ? '⛔' : '·'} [${c.scope}] ${c.key}: ${fmt(c.before)} → ${fmt(c.after)}${c.kind === 'removed' ? ' (caso removido)' : ''}`)
    }
  }
  section('Regressões', cmp.regressions)
  section('Progressões', cmp.progressions)
  section(
    'Outras mudanças',
    cmp.changes.filter((c) => c.kind === 'changed'),
  )
  return lines.join('\n')
}
