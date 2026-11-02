/**
 * Runner L3 — cliente simulada com persona até ao fim (#417 · DEC-126).
 * Orçamento próprio US$ 10; parada automática ao atingir o teto.
 */
import type { AiProviderAdapter } from '../../../../ai'
import { SimulatedAiAdapter } from '../../../../ai'
import { enqueueAutoDraft, runDueAutoDrafts } from '../../autodraft'
import { checkInvariants } from '../dialogs/invariants'
import { bootDialogScenario } from '../dialogs/scenario'
import { CostLedger, L3_BUDGET_USD, estimateDialogRepUsd } from '../l2/cost'
import { runJudge, type JudgeResult } from '../l2/judge'
import { buildEeMetrics, type EeMetrics } from '../l2/metrics'
import { TrackingAiAdapter } from '../l2/tracking-adapter'
import { L3_PERSONAS, type L3Persona } from './personas'
import { nextClientMessage } from './simulated-client'

export type L3Mode = 'dry-run' | 'live'

export type L3PersonaResult = {
  personaId: string
  ok: boolean
  truncated: boolean
  clientTurns: string[]
  outbound: string[]
  invariantsFailed: string[]
  judge: JudgeResult | null
  ee: EeMetrics
  error?: string
}

export type L3RunReport = {
  mode: L3Mode
  budget: ReturnType<CostLedger['summary']>
  truncated: boolean
  complete: boolean
  personasPlanned: string[]
  personasRun: string[]
  personasSkipped: string[]
  results: L3PersonaResult[]
  note: string
}

export type L3RunOptions = {
  mode?: L3Mode
  adapter?: AiProviderAdapter
  budgetUsd?: number
  personaIds?: string[]
  withJudge?: boolean
  agentModel?: string
  clientModel?: string
  judgeModel?: string
}

export async function runL3Suite(opts: L3RunOptions = {}): Promise<L3RunReport> {
  const mode: L3Mode = opts.mode ?? 'dry-run'
  const withJudge = opts.withJudge !== false
  const ledger = new CostLedger(opts.budgetUsd ?? L3_BUDGET_USD, 'L3')
  const estimate = estimateDialogRepUsd({
    agentCalls: 4,
    judgeCalls: withJudge ? 1 : 0,
    agentModel: opts.agentModel ?? 'claude-haiku-5-5',
    judgeModel: opts.judgeModel ?? 'claude-haiku-5-5',
  })

  const planned = (opts.personaIds ?? L3_PERSONAS.map((p) => p.id)).filter((id) =>
    L3_PERSONAS.some((p) => p.id === id),
  )
  const byId = new Map(L3_PERSONAS.map((p) => [p.id, p]))
  const baseAdapter: AiProviderAdapter =
    mode === 'live' && opts.adapter ? opts.adapter : new SimulatedAiAdapter()

  const results: L3PersonaResult[] = []
  const personasRun: string[] = []
  const personasSkipped: string[] = []

  for (const id of planned) {
    if (ledger.truncated || !ledger.canAfford(estimate)) {
      if (!ledger.truncated) {
        ledger.stop(
          `L3 parada preventiva: restante US$ ${ledger.remainingUsd.toFixed(4)} < estimativa US$ ${estimate.toFixed(4)}`,
        )
      }
      personasSkipped.push(id)
      continue
    }

    const persona = byId.get(id)!
    const one = await runOnePersona({
      persona,
      baseAdapter,
      ledger,
      mode,
      withJudge,
      clientModel: opts.clientModel,
      judgeModel: opts.judgeModel,
    })
    results.push(one)
    personasRun.push(id)
    if (ledger.truncated) {
      // as seguintes vão para skipped no próximo loop check
    }
  }

  const truncated = ledger.truncated || personasSkipped.length > 0
  const complete = !truncated && personasRun.length === planned.length

  return {
    mode,
    budget: ledger.summary(),
    truncated,
    complete,
    personasPlanned: planned,
    personasRun,
    personasSkipped,
    results,
    note: complete
      ? 'Corrida L3 completa abaixo do teto DEC-126.'
      : truncated
        ? `Corrida L3 TRUNCADA — não reportar como completa. ${ledger.stopReason ?? ''}`.trim()
        : 'Corrida L3 incompleta.',
  }
}

async function runOnePersona(opts: {
  persona: L3Persona
  baseAdapter: AiProviderAdapter
  ledger: CostLedger
  mode: L3Mode
  withJudge: boolean
  clientModel?: string
  judgeModel?: string
}): Promise<L3PersonaResult> {
  const agentTracker = new TrackingAiAdapter(opts.baseAdapter, opts.ledger, { role: 'agent' })
  agentTracker.setContext({ caseId: opts.persona.id, role: 'agent' })
  const s = bootDialogScenario({ adapter: agentTracker })
  const clientTurns: string[] = []
  const history: Array<{ role: 'client' | 'clinic'; text: string }> = []

  try {
    for (let turn = 0; turn < opts.persona.maxClientTurns; turn++) {
      if (opts.ledger.truncated) {
        return {
          personaId: opts.persona.id,
          ok: false,
          truncated: true,
          clientTurns,
          outbound: s.outboundBodies(),
          invariantsFailed: [],
          judge: null,
          ee: emptyEe(),
          error: opts.ledger.stopReason ?? 'orçamento',
        }
      }

      const next = await nextClientMessage({
        adapter: opts.baseAdapter,
        ledger: opts.ledger,
        persona: opts.persona,
        history,
        dryRun: opts.mode === 'dry-run',
        turnIndex: turn,
        model: opts.clientModel,
      })
      clientTurns.push(next.text)
      history.push({ role: 'client', text: next.text })

      const messageId = s.sayInbound(next.text)
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.conversationId, messageId }, s.clock)
      s.clock.advance(7_000)
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: agentTracker,
      })

      const latestOut = s.outboundBodies().slice(history.filter((h) => h.role === 'clinic').length)
      for (const body of latestOut) history.push({ role: 'clinic', text: body })

      if (next.done) break
    }

    const invariants = checkInvariants(s, {
      eligibleTurns: clientTurns.length,
      requireNoPause: opts.persona.id !== 'P-05' && opts.persona.id !== 'P-06' && opts.persona.id !== 'P-07',
    })
    // P-05/P-06/P-07 esperam pausa ou handoff — não forçamos requireNoPause.
    const failed = invariants.filter((i) => !i.ok).map((i) => i.id)
    const outbound = s.outboundBodies()

    const agentCalls = agentTracker.calls
    const ee = buildEeMetrics({
      modelLatenciesMs: agentCalls.map((c) => c.latencyMs),
      outboundBodies: outbound,
      agentCalls: agentCalls.length,
      discardedCalls: agentCalls.filter((c) => !c.ok).length,
      inputTokens: agentCalls.reduce((a, c) => a + c.inputTokens, 0),
      outputTokens: agentCalls.reduce((a, c) => a + c.outputTokens, 0),
    })

    let judge: JudgeResult | null = null
    if (opts.withJudge && outbound.length > 0 && !opts.ledger.truncated) {
      judge = await runJudge({
        adapter: opts.baseAdapter,
        ledger: opts.ledger,
        input: {
          caseId: opts.persona.id,
          clientTurns,
          agentOutbound: outbound,
          note: opts.persona.goal,
        },
        model: opts.judgeModel,
        dryRun: opts.mode === 'dry-run',
      })
    }

    // INV-01 (marcação sem clique) e INV-11 (sem PII) bloqueiam sempre.
    const hard = failed.filter((id) => id === 'INV-01' || id === 'INV-11')
    return {
      personaId: opts.persona.id,
      ok: hard.length === 0,
      truncated: false,
      clientTurns,
      outbound,
      invariantsFailed: failed,
      judge,
      ee,
      error: hard.length ? hard.join(', ') : undefined,
    }
  } catch (err) {
    return {
      personaId: opts.persona.id,
      ok: false,
      truncated: false,
      clientTurns,
      outbound: s.outboundBodies(),
      invariantsFailed: [],
      judge: null,
      ee: emptyEe(),
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    s.close()
  }
}

function emptyEe(): EeMetrics {
  return buildEeMetrics({
    modelLatenciesMs: [],
    outboundBodies: [],
    agentCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
  })
}

export function formatL3Report(report: L3RunReport): string {
  const lines = [
    `L3 ${report.mode} · ${report.complete ? 'COMPLETA' : report.truncated ? 'TRUNCADA' : 'incompleta'}`,
    `  orçamento US$ ${report.budget.spentUsd.toFixed(4)} / ${report.budget.ceilingUsd.toFixed(2)} (${report.budget.calls} chamadas)`,
    `  personas ${report.personasRun.length}/${report.personasPlanned.length} · skipped ${report.personasSkipped.length}`,
    `  ${report.note}`,
  ]
  for (const r of report.results) {
    lines.push(
      `  · ${r.personaId}: ${r.ok ? 'ok' : 'FAIL'} · turnos ${r.clientTurns.length} · invFail [${r.invariantsFailed.join(',')}] · Q ${r.judge?.mean?.toFixed(2) ?? '—'}`,
    )
  }
  if (report.personasSkipped.length) lines.push(`  skipped: ${report.personasSkipped.join(', ')}`)
  return lines.join('\n')
}
