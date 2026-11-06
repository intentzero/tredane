/**
 * Runner L2 — diálogos com LLM no circuito, N=3, juiz, teto DEC-117 (#417).
 * Não altera o harness L1: reutiliza runDialogCase + casos P0.
 */
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { AiProviderAdapter } from '../../../../ai'
import { SimulatedAiAdapter } from '../../../../ai'
import { P0_DIALOG_CASES } from '../dialogs/p0-cases'
import { runDialogCase, type DialogCase, type DialogRunResult } from '../dialogs/runner'
import { CostLedger, L2_BUDGET_USD, estimateDialogRepUsd } from './cost'
import { partitionL2Cases } from './held-out'
import { runJudge, type JudgeResult } from './judge'
import { buildEeMetrics, type EeMetrics } from './metrics'
import { TrackingAiAdapter } from './tracking-adapter'
import { passHatK, wilsonByCase } from '../scorecard/stats'

export type L2Mode = 'dry-run' | 'live'

export type L2RepetitionResult = {
  repetition: number
  dialog: DialogRunResult
  judge: JudgeResult | null
  ee: EeMetrics
  skippedReason?: string
}

export type L2CaseResult = {
  id: string
  heldOut: boolean
  repetitions: L2RepetitionResult[]
  /** true se alguma repetição passou invariantes+expect. */
  anyOk: boolean
  /** fracção de repetições ok. */
  passRate: number
}

export type L2RunReport = {
  mode: L2Mode
  version: {
    commit: string
    promptSha256: string | null
    catalogSha256: string | null
    agentModel: string
    judgeModel: string
    n: number
  }
  budget: ReturnType<CostLedger['summary']>
  truncated: boolean
  complete: boolean
  casesPlanned: string[]
  casesRun: string[]
  casesSkipped: string[]
  heldOutIds: string[]
  results: L2CaseResult[]
  aggregate: {
    passRate: number
    meanQ: number | null
    ee04p50: number | null
    ee04p95: number | null
    ee05pctWithin: number | null
    /** τ-bench: todas as N repetições do caso passam (consistência). */
    passHatN: number | null
    /** IC Wilson 95 % do passRate por repetição. */
    passRateCi95: { low: number; high: number } | null
  }
  note: string
}

export type L2RunOptions = {
  mode?: L2Mode
  /** Adaptador real (gateway). Em dry-run ignora-se e usa SimulatedAiAdapter. */
  adapter?: AiProviderAdapter
  n?: number
  budgetUsd?: number
  /** Subconjunto de IDs; default = elegíveis L2. */
  caseIds?: string[]
  /** Incluir conjunto reservado na corrida (mede, não afina). Default true. */
  includeHeldOut?: boolean
  /** Correr juiz (custa tokens). Default true. */
  withJudge?: boolean
  agentModel?: string
  judgeModel?: string
  commit?: string
  promptSha256?: string | null
  catalogSha256?: string | null
  /** Estimativa pré-caso para parar antes de estourar. */
  estimatePerRepUsd?: number
}

function clientTexts(c: DialogCase): string[] {
  const out: string[] = []
  for (const t of c.turns) {
    if (t.role === 'client') out.push(t.text)
    else if (t.role === 'burst') out.push(t.texts.join(' | '))
    else if (t.role === 'client_media') out.push(t.caption ? `[${t.kind}] ${t.caption}` : `[${t.kind}]`)
  }
  return out
}

async function sha256File(path: string): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises')
    const buf = await readFile(path)
    return createHash('sha256').update(buf).digest('hex')
  } catch {
    return null
  }
}

export async function resolveVersionHashes(): Promise<{
  promptSha256: string | null
  catalogSha256: string | null
}> {
  // evals/l2 → src/ai/prompt.ts  (../../../../ai/prompt.ts)
  const promptSha256 = await sha256File(
    fileURLToPath(new URL('../../../../ai/prompt.ts', import.meta.url)),
  )
  const catalogSha256 = await sha256File(
    fileURLToPath(new URL('../dialogs/scenario.ts', import.meta.url)),
  )
  return { promptSha256, catalogSha256 }
}

export async function runL2Suite(opts: L2RunOptions = {}): Promise<L2RunReport> {
  const mode: L2Mode = opts.mode ?? 'dry-run'
  const n = opts.n ?? 3
  const withJudge = opts.withJudge !== false
  const ledger = new CostLedger(opts.budgetUsd ?? L2_BUDGET_USD, 'L2')
  const hashes = await resolveVersionHashes()
  const agentModel = opts.agentModel ?? 'claude-haiku-5-5'
  const judgeModel = opts.judgeModel ?? 'claude-haiku-5-5'
  const estimate = opts.estimatePerRepUsd ?? estimateDialogRepUsd({ agentModel, judgeModel })

  const partition = partitionL2Cases()
  const heldOut = new Set(partition.heldOut)
  let planned = opts.caseIds ?? [...partition.tune, ...partition.heldOut]
  if (opts.includeHeldOut === false) planned = planned.filter((id) => !heldOut.has(id))

  const byId = new Map(P0_DIALOG_CASES.map((c) => [c.id, c]))
  const results: L2CaseResult[] = []
  const casesRun: string[] = []
  const casesSkipped: string[] = []

  const baseAdapter: AiProviderAdapter =
    mode === 'live' && opts.adapter ? opts.adapter : new SimulatedAiAdapter()

  for (const id of planned) {
    if (ledger.truncated || !ledger.canAfford(estimate)) {
      if (!ledger.truncated) {
        ledger.stop(
          `L2 parada preventiva: restante US$ ${ledger.remainingUsd.toFixed(4)} < estimativa US$ ${estimate.toFixed(4)}`,
        )
      }
      casesSkipped.push(id)
      continue
    }

    const c = byId.get(id)
    if (!c) {
      casesSkipped.push(id)
      continue
    }

    const repetitions: L2RepetitionResult[] = []
    for (let rep = 1; rep <= n; rep++) {
      if (ledger.truncated || !ledger.canAfford(estimate * 0.5)) {
        if (!ledger.truncated) {
          ledger.stop(
            `L2 truncada a meio de ${id} rep ${rep}: restante US$ ${ledger.remainingUsd.toFixed(4)}`,
          )
        }
        repetitions.push({
          repetition: rep,
          dialog: {
            id,
            ok: false,
            invariants: [],
            outbound: [],
            proposals: 0,
            appointments: 0,
            agentTurns: 0,
            error: 'truncado por orçamento',
          },
          judge: null,
          ee: buildEeMetrics({
            modelLatenciesMs: [],
            outboundBodies: [],
            agentCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
          }),
          skippedReason: ledger.stopReason ?? 'orçamento',
        })
        break
      }

      // Live: sempre o gateway. Dry-run: preserva adaptador injectado do caso (ex. timeout).
      const inner = mode === 'live' ? baseAdapter : (c.adapter ?? baseAdapter)
      const tracker = new TrackingAiAdapter(inner, ledger, { role: 'agent' })
      tracker.setContext({ caseId: id, repetition: rep, role: 'agent' })

      const dialogCase: DialogCase = {
        ...c,
        adapter: tracker,
      }
      const dialog = await runDialogCase(dialogCase)

      const agentCalls = tracker.calls.filter((x) => x.role === 'agent')
      const latencies = agentCalls.map((x) => x.latencyMs)
      const inTok = agentCalls.reduce((s, x) => s + x.inputTokens, 0)
      const outTok = agentCalls.reduce((s, x) => s + x.outputTokens, 0)
      const ee = buildEeMetrics({
        modelLatenciesMs: latencies,
        outboundBodies: dialog.outbound,
        agentCalls: agentCalls.length,
        discardedCalls: agentCalls.filter((x) => !x.ok).length,
        inputTokens: inTok,
        outputTokens: outTok,
      })

      let judge: JudgeResult | null = null
      if (withJudge && dialog.outbound.length > 0 && !ledger.truncated) {
        judge = await runJudge({
          adapter: baseAdapter,
          ledger,
          input: {
            caseId: id,
            clientTurns: clientTexts(c),
            agentOutbound: dialog.outbound,
          },
          model: judgeModel,
          dryRun: mode === 'dry-run',
        })
      }

      repetitions.push({ repetition: rep, dialog, judge, ee })
    }

    const okReps = repetitions.filter((r) => r.dialog.ok && !r.skippedReason)
    results.push({
      id,
      heldOut: heldOut.has(id),
      repetitions,
      anyOk: okReps.length > 0,
      passRate: repetitions.length ? okReps.length / repetitions.length : 0,
    })
    casesRun.push(id)
  }

  const allReps = results.flatMap((r) => r.repetitions.filter((x) => !x.skippedReason))
  const qMeans = allReps.map((r) => r.judge?.mean).filter((m): m is number => m != null)
  const latAll = allReps.flatMap((r) => r.ee.ee04.samplesMs).sort((a, b) => a - b)
  const ee05vals = allReps
    .map((r) => r.ee.ee05.pctWithinLimit)
    .filter((v): v is number => v != null)

  const truncated = ledger.truncated || casesSkipped.length > 0
  const complete = !truncated && casesRun.length === planned.length

  return {
    mode,
    version: {
      commit: opts.commit ?? 'unknown',
      promptSha256: opts.promptSha256 ?? hashes.promptSha256,
      catalogSha256: opts.catalogSha256 ?? hashes.catalogSha256,
      agentModel,
      judgeModel,
      n,
    },
    budget: ledger.summary(),
    truncated,
    complete,
    casesPlanned: planned,
    casesRun,
    casesSkipped,
    heldOutIds: [...heldOut],
    results,
    aggregate: {
      passRate:
        allReps.length === 0 ? 0 : allReps.filter((r) => r.dialog.ok).length / allReps.length,
      meanQ: qMeans.length ? qMeans.reduce((a, b) => a + b, 0) / qMeans.length : null,
      ee04p50: latAll.length ? latAll[Math.ceil(0.5 * latAll.length) - 1]! : null,
      ee04p95: latAll.length ? latAll[Math.ceil(0.95 * latAll.length) - 1]! : null,
      ee05pctWithin: ee05vals.length ? ee05vals.reduce((a, b) => a + b, 0) / ee05vals.length : null,
      passHatN: passHatK(
        results.map((r) => {
          const reps = r.repetitions.filter((x) => !x.skippedReason)
          return { n: reps.length, c: reps.filter((x) => x.dialog.ok).length }
        }),
        n,
      ),
      // IC por caso (repetições do mesmo caso são correlacionadas).
      passRateCi95: wilsonByCase(
        results.map((r) => {
          const reps = r.repetitions.filter((x) => !x.skippedReason)
          return { n: reps.length, c: reps.filter((x) => x.dialog.ok).length }
        }),
      ),
    },
    note: complete
      ? 'Corrida L2 completa abaixo do teto DEC-117.'
      : truncated
        ? `Corrida L2 TRUNCADA — não reportar como completa. ${ledger.stopReason ?? ''}`.trim()
        : 'Corrida L2 incompleta.',
  }
}

export function formatL2Report(report: L2RunReport): string {
  const lines: string[] = [
    `L2 ${report.mode} · ${report.complete ? 'COMPLETA' : report.truncated ? 'TRUNCADA' : 'incompleta'}`,
    `  commit ${report.version.commit} · N=${report.version.n}`,
    `  agente ${report.version.agentModel} · juiz ${report.version.judgeModel}`,
    `  prompt sha256:${report.version.promptSha256?.slice(0, 16) ?? '?'}…`,
    `  catálogo sha256:${report.version.catalogSha256?.slice(0, 16) ?? '?'}…`,
    `  orçamento US$ ${report.budget.spentUsd.toFixed(4)} / ${report.budget.ceilingUsd.toFixed(2)} (${report.budget.calls} chamadas, in=${report.budget.inputTokens} out=${report.budget.outputTokens})`,
    `  casos ${report.casesRun.length}/${report.casesPlanned.length} · skipped ${report.casesSkipped.length} · held-out ${report.heldOutIds.length}`,
    `  passRate ${(report.aggregate.passRate * 100).toFixed(1)}%${report.aggregate.passRateCi95 ? ` [IC95 ${(report.aggregate.passRateCi95.low * 100).toFixed(1)}–${(report.aggregate.passRateCi95.high * 100).toFixed(1)}%]` : ''} · pass^${report.version.n} ${report.aggregate.passHatN == null ? '—' : `${(report.aggregate.passHatN * 100).toFixed(1)}%`} · meanQ ${report.aggregate.meanQ?.toFixed(2) ?? '—'}`,
    `  EE-04 p50=${report.aggregate.ee04p50 ?? '—'}ms p95=${report.aggregate.ee04p95 ?? '—'}ms · EE-05 within ${report.aggregate.ee05pctWithin?.toFixed(1) ?? '—'}%`,
    `  ${report.note}`,
  ]
  for (const r of report.results) {
    const flag = r.heldOut ? ' [held-out]' : ''
    lines.push(
      `  · ${r.id}${flag}: pass ${(r.passRate * 100).toFixed(0)}% (${r.repetitions.length} reps)`,
    )
  }
  if (report.casesSkipped.length) {
    lines.push(`  skipped: ${report.casesSkipped.join(', ')}`)
  }
  return lines.join('\n')
}
