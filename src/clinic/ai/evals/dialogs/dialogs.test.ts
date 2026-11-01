/**
 * Harness L1 — casos P0 da matriz (#406, DEC-108).
 * As invariantes (INV) bloqueiam o merge. EE/Q ficam informativos.
 *
 * - `knownFailure` é um it.fails verdadeiro: o caso corre sempre e TEM de falhar;
 *   se passar, o CI falha até se remover a marca. INV-01 (marcação) bloqueia sempre.
 * - `pendingHarness`: só as invariantes de segurança; fora da contagem de passes.
 * - `coverageOnly`: aponta para outro teste; não conta como executado.
 */
import { describe, expect, it } from 'vitest'
import { P0_DIALOG_CASES, P0_IDS } from './p0-cases'
import { formatDialogReport, runDialogCase, type DialogRunResult } from './runner'

/** Mesmo em pendentes ou falhas conhecidas, estas nunca podem falhar. */
const ALWAYS_BLOCKING = ['INV-01', 'INV-02', 'INV-04', 'INV-05', 'INV-11']

describe('harness L1 diálogos P0 (#406)', () => {
  const CASE_TIMEOUT_MS = 30_000

  it('regista todos os P0 da matriz', () => {
    expect(P0_IDS).toHaveLength(P0_DIALOG_CASES.length)
    expect(new Set(P0_IDS).size).toBe(P0_IDS.length)
  })

  const results: DialogRunResult[] = []

  for (const c of P0_DIALOG_CASES) {
    const tag = c.knownFailure ? ` [${c.knownFailure}]` : c.pendingHarness ? ` [pendente: ${c.pendingHarness}]` : ''
    const label = `${c.id} · ${c.title}${tag}`

    if (c.coverageOnly) {
      it(`${label} (cobertura: ${c.coverageOnly})`, () => {
        expect(c.coverageOnly!.length).toBeGreaterThan(0)
        results.push({ id: c.id, ok: true, status: 'covered', invariants: [], outbound: [], proposals: 0, appointments: 0, agentTurns: 0 })
      })
      continue
    }

    it(
      label,
      async () => {
        const r = await runDialogCase(c)
        const hardFails = r.invariants.filter((i) => !i.ok && ALWAYS_BLOCKING.includes(i.id))

        if (c.knownFailure) {
          r.status = 'known_failure'
          results.push(r)
          const inv01 = r.invariants.find((i) => i.id === 'INV-01')
          if (inv01 && !inv01.ok) throw new Error(`${c.id}: INV-01 (marcação sem clique) bloqueia mesmo com falha conhecida`)
          if (r.ok) {
            r.status = 'fail'
            throw new Error(`${c.id} passou: remover knownFailure «${c.knownFailure}» e creditar a correção na matriz`)
          }
          return
        }
        if (c.pendingHarness) {
          r.status = 'pending'
          results.push(r)
          if (hardFails.length > 0) throw new Error(`${c.id}: ${hardFails.map((f) => f.id).join(', ')}`)
          return
        }
        r.status = r.ok ? 'pass' : 'fail'
        results.push(r)
        if (!r.ok) throw new Error(r.error ?? 'dialog failed')
      },
      CASE_TIMEOUT_MS,
    )
  }

  it('relatório L1 (colar no §7)', () => {
    expect(results.length).toBeGreaterThan(0)
    process.stdout.write(`\n${formatDialogReport(results)}\n`)
  })
})
