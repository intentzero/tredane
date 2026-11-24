import { describe, expect, it } from 'vitest'
import {
  bestProfessionalByGravity,
  gravityFor,
  pickSlots,
  type Attractor,
  type PickCandidate,
} from './pick-slots'

const MIN = 60_000
const DAY = Date.UTC(2026, 10, 25, 3, 0, 0) // 00:00 em America/Sao_Paulo (UTC-3)
const at = (h: number, m = 0) => DAY + (h * 60 + m) * MIN

/** Grade de 15 min entre `from` e `to` (início), 30 min de duração, livre para as profissionais dadas. */
function grid(fromH: number, toH: number, pros: string[] = ['gi']): PickCandidate[] {
  const out: PickCandidate[] = []
  for (let m = fromH * 60; m <= toH * 60; m += 15) {
    out.push({ startsAt: at(0, m), occupiesUntil: at(0, m + 30), professionalIds: pros })
  }
  return out
}

const gi14: Attractor = { professionalId: 'gi', startsAt: at(14), occupiesUntil: at(15) }

describe('gravityFor', () => {
  it('colada à marcação da mesma profissional vale 1', () => {
    expect(gravityFor(at(15), at(15, 30), 'gi', [gi14])).toBe(1)
    expect(gravityFor(at(13, 30), at(14), 'gi', [gi14])).toBe(1)
  })

  it('cai linearmente até ao raio e zera além dele', () => {
    expect(gravityFor(at(16, 30), at(17), 'gi', [gi14])).toBeCloseTo(0.5, 5) // 90 min de distância
    expect(gravityFor(at(18), at(18, 30), 'gi', [gi14])).toBe(0) // 180 min
    expect(gravityFor(at(19), at(19, 30), 'gi', [gi14])).toBe(0)
  })

  it('outra profissional pesa metade', () => {
    expect(gravityFor(at(15), at(15, 30), 'paula', [gi14])).toBe(0.5)
  })

  it('sem marcações não há gravidade', () => {
    expect(gravityFor(at(15), at(15, 30), 'gi', [])).toBe(0)
  })
})

describe('bestProfessionalByGravity', () => {
  it('prefere quem tem marcação colada; empate fica com a primeira da lista', () => {
    expect(bestProfessionalByGravity(at(15), at(15, 30), ['paula', 'gi'], [gi14])?.professionalId).toBe('gi')
    expect(bestProfessionalByGravity(at(9), at(9, 30), ['paula', 'gi'], [])?.professionalId).toBe('paula')
  })
})

describe('pickSlots', () => {
  it('dia vazio: 3 horas a partir da âncora, a 30 min ou mais umas das outras', () => {
    const r = pickSlots(grid(9, 18), [], { anchorMs: at(9) })
    expect(r.slots.map((s) => s.startsAt)).toEqual([at(9), at(9, 30), at(10)])
    expect(r.hasMore).toBe(true)
  })

  it('marcação confirmada 14:00–15:00 atrai 13:30 e 15:00 antes de horas soltas', () => {
    // Candidatas que se sobrepõem à marcação das 14:00–15:00 não estão livres.
    const cands = grid(9, 18).filter((c) => c.startsAt <= at(14) - 30 * MIN || c.startsAt >= at(15))
    const r = pickSlots(cands, [gi14], { anchorMs: at(9) })
    const times = r.slots.map((s) => s.startsAt)
    expect(times).toContain(at(13, 30))
    expect(times).toContain(at(15))
    expect(times).not.toContain(at(9))
    expect(r.slots.every((s) => s.professionalId === 'gi')).toBe(true)
  })

  it('o terceiro horário respeita o espaçamento mínimo', () => {
    const cands = grid(9, 18).filter((c) => c.startsAt < at(13, 30) || c.startsAt >= at(15))
    const r = pickSlots(cands, [gi14], { anchorMs: at(9) })
    const times = r.slots.map((s) => s.startsAt).sort((a, b) => a - b)
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(30 * MIN)
  })

  it('hora pedida livre sai primeiro, mesmo longe de qualquer marcação', () => {
    const r = pickSlots(grid(9, 18), [gi14], { anchorMs: at(9), requestedStartMs: at(10) })
    expect(r.slots.map((s) => s.startsAt)).toContain(at(10))
    expect(r.slots.filter((s) => s.startsAt === at(10))).toHaveLength(1)
  })

  it('hora pedida ocupada: as vizinhas pela gravidade e pela proximidade', () => {
    const cands = grid(9, 12).filter((c) => c.startsAt !== at(10))
    const r = pickSlots(cands, [], { anchorMs: at(10), requestedStartMs: at(10) })
    expect(r.slots.map((s) => s.startsAt)).not.toContain(at(10))
    expect(r.slots.map((s) => s.startsAt)).toContain(at(9, 45))
  })

  it('«Outros horários» não repete o que já foi mostrado', () => {
    const cands = grid(9, 18)
    const first = pickSlots(cands, [], { anchorMs: at(9), offset: 0 })
    const second = pickSlots(cands, [], { anchorMs: at(9), offset: 3 })
    const seen = new Set(first.slots.map((s) => s.startsAt))
    expect(second.slots.length).toBe(3)
    for (const s of second.slots) expect(seen.has(s.startsAt)).toBe(false)
  })

  it('última página: hasMore falso; poucas horas devolvem o que há', () => {
    const r = pickSlots(grid(9, 9, ['gi']), [], { anchorMs: at(9) })
    expect(r.slots).toHaveLength(1)
    expect(r.hasMore).toBe(false)
  })

  it('sem candidatas devolve vazio', () => {
    expect(pickSlots([], [gi14], { anchorMs: at(9) })).toEqual({ slots: [], hasMore: false })
  })
})
