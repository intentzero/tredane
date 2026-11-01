/**
 * Harness L1 — casos P0 da matriz (#406, DEC-108).
 * INV bloqueiam; EE/Q informativos.
 * knownFailure: regista o achado; se o L1 ainda não reproduz, o relatório avisa
 * (não bloqueia o CI). Quando a correção entra, remove-se o flag.
 */
import { describe, expect, it } from 'vitest'
import { P0_DIALOG_CASES, P0_IDS } from './p0-cases'
import { formatDialogReport, runDialogCase, type DialogRunResult } from './runner'

describe('harness L1 diálogos P0 (#406)', () => {
  // Multi-turno com autodraft: o default 5 s do Vitest estoura no CI.
  const CASE_TIMEOUT_MS = 30_000

  it('regista todos os 53 P0 da matriz', () => {
    expect(P0_IDS).toHaveLength(53)
    expect(new Set(P0_IDS).size).toBe(53)
  })

  const results: DialogRunResult[] = []

  for (const c of P0_DIALOG_CASES) {
    const label = `${c.id} · ${c.title}${c.knownFailure ? ` [${c.knownFailure}]` : ''}`

    if (c.coverageOnly) {
      it(`${label} (cobertura: ${c.coverageOnly})`, () => {
        expect(c.coverageOnly!.length).toBeGreaterThan(0)
        results.push({
          id: c.id,
          ok: true,
          invariants: [],
          outbound: [],
          proposals: 0,
          appointments: 0,
          agentTurns: 0,
        })
      })
      continue
    }

    it(
      label,
      async () => {
        const r = await runDialogCase(c)
        results.push(r)
        if (c.knownFailure) {
          // Preferimos reproduzir a falha; se o L1 ainda não a apanha, não bloqueia merge
          // (DEC-108: INV nos P0; EE informativos). O relatório lista os não reproduzidos.
          if (r.ok) {
            r.knownFailure = `${c.knownFailure} (L1 ainda não reproduz)`
          }
          return
        }
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
