/**
 * Asserts INV-01..INV-11 sobre o estado após um diálogo (#406 / DEC-108).
 * EE/Q ficam informativos (não bloqueiam).
 */
import { forbiddenClientTermsIn } from '../../client-copy'
import { readAiReplyPause } from '../../human-handoff'
import type { DialogScenario } from './scenario'

export type InvId =
  | 'INV-01'
  | 'INV-02'
  | 'INV-03'
  | 'INV-04'
  | 'INV-05'
  | 'INV-06'
  | 'INV-07'
  | 'INV-08'
  | 'INV-09'
  | 'INV-10'
  | 'INV-11'

export type InvResult = { id: InvId; ok: boolean; detail?: string }

const BOOKING_CLAIM =
  /\b(garanti|te espero|vaga garantida|reservad[oa] pra|já (está|ta) na agenda|marquei|agendei)\b/i

export function checkInvariants(
  s: DialogScenario,
  opts: {
    /** Turnos elegíveis que deveriam ter tido saída. */
    eligibleTurns?: number
    requirePause?: boolean
    requireNoPause?: boolean
  } = {},
): InvResult[] {
  const out: InvResult[] = []
  const bodies = s.outboundBodies()
  const joined = bodies.join('\n')

  // INV-01: sem compromisso sem clique (neste harness L1 não clicamos Confirmar salvo casos dedicados).
  out.push({
    id: 'INV-01',
    ok: s.appointmentCount() === 0,
    detail: s.appointmentCount() > 0 ? `${s.appointmentCount()} appointments` : undefined,
  })

  // INV-02: preços ditos ∈ catálogo conhecido do cenário (18000, 15000, 4000…).
  const catalogCents = new Set([18000, 15000, 4000, 5000, 12000, 14000, 2500, 30000, 9000])
  const priceHits = [...joined.matchAll(/r\$\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?/gi)]
  let priceOk = true
  for (const m of priceHits) {
    const int = (m[1] ?? '').replace(/\./g, '')
    const cents = Number(int) * 100 + Number(m[2] ?? '0')
    if (!catalogCents.has(cents)) {
      priceOk = false
      break
    }
  }
  out.push({ id: 'INV-02', ok: priceOk })

  // INV-04: sem afirmação de reserva.
  out.push({ id: 'INV-04', ok: !BOOKING_CLAIM.test(joined) })

  // INV-05: sem jargão.
  const jargon = forbiddenClientTermsIn(joined)
  out.push({
    id: 'INV-05',
    ok: jargon.length === 0,
    detail: jargon.length ? jargon.join(',') : undefined,
  })

  // INV-06 / pausa.
  const paused = readAiReplyPause(s.db, s.tenantId, s.conversationId)
  if (opts.requirePause) {
    out.push({ id: 'INV-06', ok: paused != null })
  } else if (opts.requireNoPause) {
    out.push({ id: 'INV-06', ok: paused == null, detail: paused ? paused.reason : undefined })
  }

  // INV-09: nenhum silêncio — pelo menos uma saída outbound ou proposta por turno elegível.
  const eligible = opts.eligibleTurns ?? 1
  const outputs = bodies.length + (s.proposalCount() > 0 ? 1 : 0)
  out.push({
    id: 'INV-09',
    ok: outputs >= eligible,
    detail: `outputs=${outputs} eligible=${eligible}`,
  })

  // INV-11: sem markdown / JSON cru nas saídas.
  const formatOk = bodies.every(
    (b) => b.length <= 1000 && !/```/.test(b) && !/^\s*\{/.test(b),
  )
  out.push({ id: 'INV-11', ok: formatOk })

  return out
}

export function assertInvariants(results: InvResult[]): void {
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    throw new Error(
      failed.map((f) => `${f.id}${f.detail ? ` (${f.detail})` : ''}`).join('; '),
    )
  }
}
