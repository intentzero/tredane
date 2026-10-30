import { describe, expect, it } from 'vitest'
import { suggestVariantKindPlural, variantKindLabels } from './variant-kind'

describe('suggestVariantKindPlural', () => {
  it.each([
    ['Zona', 'Zonas'],
    ['Técnica', 'Técnicas'],
    ['Sessão', 'Sessões'],
    ['Axial', 'Axiais'],
    ['Nuvem', 'Nuvens'],
    ['Tamanho', 'Tamanhos'],
    ['Cor', 'Cores'],
    ['Zonas', 'Zonas'],
    ['', ''],
  ])('%s → %s', (singular, plural) => {
    expect(suggestVariantKindPlural(singular)).toBe(plural)
  })
})

describe('variantKindLabels', () => {
  it('usa o plural gravado e concorda com a quantidade', () => {
    const l = variantKindLabels({ variantKind: 'Laser', variantKindPlural: 'Lasers' })
    expect(l.plural).toBe('Lasers')
    expect(l.count(1)).toBe('1 laser')
    expect(l.count(4)).toBe('4 lasers')
  })

  it('sugere o plural quando não há gravado', () => {
    const l = variantKindLabels({ variantKind: 'Zona', variantKindPlural: null })
    expect(l.count(1)).toBe('1 zona')
    expect(l.count(2)).toBe('2 zonas')
  })

  it('sem tipo cai em «variante»', () => {
    const l = variantKindLabels({})
    expect(l.singular).toBe('Variante')
    expect(l.count(3)).toBe('3 variantes')
  })
})
