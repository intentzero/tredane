/**
 * Seletor de horários para a página da cliente (DEC-227, Proposto).
 *
 * Função pura: recebe as horas livres de um dia (da grade de 15 min do motor) e as marcações
 * **confirmadas** do mesmo dia, e devolve poucas horas — as que melhor aproveitam quem já está
 * a atender. Nunca devolve a grade inteira.
 *
 * - Gravidade: uma marcação confirmada atrai as horas coladas a ela. Mesma profissional pesa 1,
 *   outra profissional no mesmo dia pesa metade; a pontuação cai linearmente até `attractRadiusMinutes`.
 * - Hora pedida e livre sai em primeiro lugar, fora da gravidade.
 * - Os escolhidos de uma página ficam a `minGapMinutes` ou mais uns dos outros.
 * - Páginas seguintes («Outros horários») não repetem horas já mostradas.
 */

export const PICK_PAGE_SIZE = 3
export const PICK_MIN_GAP_MINUTES = 30
/** Valor inicial; a validar com a clínica piloto (DEC-227). */
export const PICK_ATTRACT_RADIUS_MINUTES = 180
const OTHER_PROFESSIONAL_WEIGHT = 0.5
const MIN_MS = 60_000

export type PickCandidate = {
  startsAt: number
  /** Fim da ocupação (duração + intervalo). */
  occupiesUntil: number
  /** Profissionais livres neste início, na ordem de desempate preferida (rodízio). */
  professionalIds: string[]
}

/** Marcação confirmada do dia (holds e pendentes de Pix não atraem). */
export type Attractor = {
  professionalId: string | null
  startsAt: number
  occupiesUntil: number
}

export type PickOptions = {
  limit?: number
  /** Múltiplo de `limit`: 0 = primeira página. */
  offset?: number
  minGapMinutes?: number
  attractRadiusMinutes?: number
  /** Início da conveniência pedida; desempata pela proximidade. */
  anchorMs: number
  /** Hora exacta pedida pela cliente; se estiver livre sai primeiro. */
  requestedStartMs?: number | null
}

export type PickedSlot = {
  startsAt: number
  /** Profissional com mais gravidade nesta hora (empate: a primeira da lista). */
  professionalId: string
}

export type PickResult = { slots: PickedSlot[]; hasMore: boolean }

/** Distância em minutos entre a janela do candidato e a do atractor (0 = coladas ou sobrepostas). */
function gapMinutes(candStart: number, candEnd: number, a: Attractor): number {
  if (candEnd <= a.startsAt) return (a.startsAt - candEnd) / MIN_MS
  if (candStart >= a.occupiesUntil) return (candStart - a.occupiesUntil) / MIN_MS
  return 0
}

/** Gravidade de uma hora para uma profissional: 0 (nada perto) a 1 (colada a marcação dela). */
export function gravityFor(
  startsAt: number,
  occupiesUntil: number,
  professionalId: string,
  attractors: readonly Attractor[],
  radiusMinutes: number = PICK_ATTRACT_RADIUS_MINUTES,
): number {
  let best = 0
  for (const a of attractors) {
    const gap = gapMinutes(startsAt, occupiesUntil, a)
    if (gap > radiusMinutes) continue
    const weight = a.professionalId === professionalId ? 1 : OTHER_PROFESSIONAL_WEIGHT
    const score = (1 - gap / radiusMinutes) * weight
    if (score > best) best = score
  }
  return best
}

/** Entre as profissionais livres, a de maior gravidade (empate: a primeira da lista). */
export function bestProfessionalByGravity(
  startsAt: number,
  occupiesUntil: number,
  professionalIds: readonly string[],
  attractors: readonly Attractor[],
  radiusMinutes: number = PICK_ATTRACT_RADIUS_MINUTES,
): { professionalId: string; score: number } | null {
  let pick: { professionalId: string; score: number } | null = null
  for (const id of professionalIds) {
    const score = gravityFor(startsAt, occupiesUntil, id, attractors, radiusMinutes)
    if (!pick || score > pick.score) pick = { professionalId: id, score }
  }
  return pick
}

type Ranked = { candidate: PickCandidate; professionalId: string; score: number }

export function pickSlots(
  candidates: readonly PickCandidate[],
  attractors: readonly Attractor[],
  opts: PickOptions,
): PickResult {
  const limit = Math.max(1, opts.limit ?? PICK_PAGE_SIZE)
  const offset = Math.max(0, opts.offset ?? 0)
  const minGapMs = (opts.minGapMinutes ?? PICK_MIN_GAP_MINUTES) * MIN_MS
  const radius = opts.attractRadiusMinutes ?? PICK_ATTRACT_RADIUS_MINUTES
  const anchor = opts.requestedStartMs ?? opts.anchorMs

  const ranked: Ranked[] = []
  for (const c of candidates) {
    const best = bestProfessionalByGravity(c.startsAt, c.occupiesUntil, c.professionalIds, attractors, radius)
    if (best) ranked.push({ candidate: c, professionalId: best.professionalId, score: best.score })
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      Math.abs(a.candidate.startsAt - anchor) - Math.abs(b.candidate.startsAt - anchor) ||
      a.candidate.startsAt - b.candidate.startsAt,
  )

  // Hora pedida e livre: sempre a primeira da primeira página.
  if (opts.requestedStartMs != null) {
    const i = ranked.findIndex((r) => r.candidate.startsAt === opts.requestedStartMs)
    if (i > 0) ranked.unshift(ranked.splice(i, 1)[0]!)
  }

  const remaining = [...ranked]
  const pageIndex = Math.floor(offset / limit)
  let page: Ranked[] = []
  for (let p = 0; p <= pageIndex && remaining.length > 0; p++) {
    page = []
    for (let i = 0; i < remaining.length && page.length < limit; ) {
      const r = remaining[i]!
      const farEnough = page.every((q) => Math.abs(q.candidate.startsAt - r.candidate.startsAt) >= minGapMs)
      if (farEnough) {
        page.push(r)
        remaining.splice(i, 1)
      } else {
        i++
      }
    }
    // Sobraram só horas coladas às já escolhidas: preenche sem exigir o espaçamento.
    while (page.length < limit && remaining.length > 0) page.push(remaining.shift()!)
  }

  const slots = page
    .sort((a, b) => a.candidate.startsAt - b.candidate.startsAt)
    .map((r) => ({ startsAt: r.candidate.startsAt, professionalId: r.professionalId }))
  return { slots: pageIndex * limit === offset ? slots : [], hasMore: remaining.length > 0 }
}
