import { describe, expect, it } from 'vitest'
import { bestCombo, priceVisit, type ComboDef, type ComboZone } from './combo'

const z = (id: string, priceCents: number | null, active = true): ComboZone => ({
  id,
  priceCents,
  active,
})
const combo = (
  id: string,
  priceCents: number,
  zoneIds: string[],
  extra: Partial<ComboDef> = {},
): ComboDef => ({ id, name: id, priceCents, zoneIds, active: true, sortOrder: 0, ...extra })

const axila = z('axila', 5000)
const buco = z('buco', 3500)
const meia = z('meia', 9000)

describe('combos de variantes (DEC-080)', () => {
  it('aplica sozinho quando todas as variantes do combo foram escolhidas', () => {
    const p = priceVisit([axila, buco], [combo('c1', 7000, ['buco', 'axila'])])
    expect(p).toMatchObject({ listPriceCents: 8500, priceCents: 7000 })
    expect(p.applied?.discountCents).toBe(1500)
  })

  it('as variantes que sobram saem pelo preço normal', () => {
    const p = priceVisit([axila, buco, meia], [combo('c1', 7000, ['buco', 'axila'])])
    expect(p.priceCents).toBe(7000 + 9000)
  })

  it('não aplica se falta uma variante do combo', () => {
    expect(bestCombo([axila], [combo('c1', 7000, ['buco', 'axila'])])).toBeNull()
  })

  it('vale só o de maior desconto, sem somar dois combos', () => {
    const a = combo('a', 7000, ['buco', 'axila'])
    const b = combo('b', 15000, ['axila', 'meia', 'buco'])
    const p = priceVisit([axila, buco, meia], [a, b])
    expect(p.applied?.combo.id).toBe('b')
    expect(p.priceCents).toBe(15000)
  })

  it('empate de desconto: ordem do catálogo', () => {
    const a = combo('a', 7000, ['buco', 'axila'], { sortOrder: 2 })
    const b = combo('b', 7000, ['buco', 'axila'], { sortOrder: 1 })
    expect(bestCombo([axila, buco], [a, b])?.combo.id).toBe('b')
  })

  it('deixa de valer se não sai mais barato que a soma (o preço de uma variante mudou)', () => {
    expect(bestCombo([axila, z('buco', 2000)], [combo('c1', 7000, ['buco', 'axila'])])).toBeNull()
    expect(bestCombo([axila, buco], [combo('c1', 8500, ['buco', 'axila'])])).toBeNull()
  })

  it('não aplica com combo inativo, variante fora de uso ou sem preço', () => {
    expect(bestCombo([axila, buco], [combo('c1', 7000, ['buco', 'axila'], { active: false })])).toBeNull()
    expect(bestCombo([axila, z('buco', 3500, false)], [combo('c1', 7000, ['buco', 'axila'])])).toBeNull()
    expect(bestCombo([axila, z('buco', null)], [combo('c1', 7000, ['buco', 'axila'])])).toBeNull()
  })

  it('sem preço somável, o total fica nulo', () => {
    const p = priceVisit([axila, z('buco', null)], [])
    expect(p).toEqual({ priceCents: null, listPriceCents: null, applied: null })
  })
})
