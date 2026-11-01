/**
 * Runner L1: aplica turnos inbound via enqueueAutoDraft + runDueAutoDrafts (#406).
 */
import type { AiProviderAdapter } from '../../../../ai'
import { enqueueAutoDraft, runDueAutoDrafts } from '../../index'
import { assertInvariants, checkInvariants, type InvResult } from './invariants'
import { bootDialogScenario, type DialogScenario } from './scenario'

export type DialogTurn =
  | { role: 'client'; text: string }
  | { role: 'setup'; note: string }

export type DialogCase = {
  id: string
  title: string
  /** Turnos ideais do agente (matriz T*). */
  turnosIdeais: number
  turns: DialogTurn[]
  /** Se definido, o caso corre como `it.fails` com este achado. */
  knownFailure?: string
  /** Já coberto por outro teste; o harness só regista o ID. */
  coverageOnly?: string
  /** Adaptador opcional (timeout, texto fixo…). */
  adapter?: AiProviderAdapter
  /** Asserções extra além das INV. */
  expect?: {
    outboundIncludes?: string[]
    outboundExcludes?: RegExp[]
    proposal?: boolean
    noAppointment?: boolean
    paused?: boolean
    notPaused?: boolean
  }
}

export type DialogRunResult = {
  id: string
  ok: boolean
  knownFailure?: string
  invariants: InvResult[]
  outbound: string[]
  proposals: number
  appointments: number
  agentTurns: number
  error?: string
}

export async function runDialogCase(c: DialogCase): Promise<DialogRunResult> {
  const s = bootDialogScenario({ adapter: c.adapter })
  let agentTurns = 0
  try {
    for (const turn of c.turns) {
      if (turn.role !== 'client') continue
      const messageId = s.sayInbound(turn.text)
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId },
        s.clock,
      )
      s.clock.advance(7_000)
      const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: s.adapter,
      })
      if (out.length > 0) agentTurns += 1
    }

    const invariants = checkInvariants(s, {
      eligibleTurns: c.turns.filter((t) => t.role === 'client').length,
      requirePause: c.expect?.paused,
      requireNoPause: c.expect?.notPaused ?? c.expect?.paused === false,
    })

    const outbound = s.outboundBodies()
    if (c.expect?.outboundIncludes) {
      for (const frag of c.expect.outboundIncludes) {
        if (!outbound.some((b) => b.includes(frag))) {
          throw new Error(`outbound missing «${frag}»; got ${JSON.stringify(outbound)}`)
        }
      }
    }
    if (c.expect?.outboundExcludes) {
      for (const re of c.expect.outboundExcludes) {
        if (outbound.some((b) => re.test(b))) {
          throw new Error(`outbound matched forbidden ${re}`)
        }
      }
    }
    if (c.expect?.proposal === true && s.proposalCount() < 1) {
      throw new Error('expected proposal')
    }
    if (c.expect?.proposal === false && s.proposalCount() > 0) {
      throw new Error('unexpected proposal')
    }
    if (c.expect?.noAppointment !== false) {
      // default: no appointment unless case is a confirm-click case
    }
    assertInvariants(invariants.filter((i) => i.id !== 'INV-06' || c.expect?.paused != null || c.expect?.notPaused))

    return {
      id: c.id,
      ok: true,
      knownFailure: c.knownFailure,
      invariants,
      outbound,
      proposals: s.proposalCount(),
      appointments: s.appointmentCount(),
      agentTurns,
    }
  } catch (err) {
    return {
      id: c.id,
      ok: false,
      knownFailure: c.knownFailure,
      invariants: [],
      outbound: s.outboundBodies(),
      proposals: s.proposalCount(),
      appointments: s.appointmentCount(),
      agentTurns,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    s.close()
  }
}

export function formatDialogReport(results: DialogRunResult[]): string {
  const pass = results.filter((r) => r.ok && !r.knownFailure)
  const expectedFail = results.filter((r) => r.knownFailure)
  const unexpected = results.filter((r) => !r.ok && !r.knownFailure)
  const lines = [
    `diálogos L1: ${results.length} casos`,
    `  passam: ${pass.length}`,
    `  it.fails (achado conhecido): ${expectedFail.length}`,
    `  falhas inesperadas: ${unexpected.length}`,
  ]
  for (const r of unexpected) {
    lines.push(`  !! ${r.id}: ${r.error}`)
  }
  for (const r of expectedFail) {
    lines.push(`  · ${r.id} → ${r.knownFailure}${r.ok ? ' (inesperadamente verde)' : ''}`)
  }
  return lines.join('\n')
}
