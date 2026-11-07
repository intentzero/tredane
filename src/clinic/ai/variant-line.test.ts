import { describe, expect, it } from 'vitest'
import {
  stableVariantLabelList,
  variantKindForAsk,
  variantListQuestion,
} from './variant-line'

const MASSAGEM_TYPES = [
  { id: 'z1', name: 'Liberação miofascial', audience: 'ambos' as const, durationMinutes: 50, priceCents: 15_000 },
  { id: 'z2', name: 'Massagem relaxante', audience: 'ambos' as const, durationMinutes: 50, priceCents: 15_000 },
]

describe('rótulo estável das variantes', () => {
  it('deduplica pelo id e distingue o mesmo nome na mesma audiência', () => {
    const axila = {
      id: 'z1',
      name: 'Axila',
      audience: 'feminino' as const,
      durationMinutes: 15,
      priceCents: 5_000,
    }
    const labels = stableVariantLabelList([
      axila,
      axila,
      { id: 'z2', name: 'Pernas', audience: 'feminino', durationMinutes: 30, priceCents: 14_000 },
      { id: 'z3', name: 'Pernas', audience: 'feminino', durationMinutes: 45, priceCents: 16_000 },
    ])
    expect(labels).toEqual(['Axila', 'Pernas (feminino, 30 min)', 'Pernas (feminino, 45 min)'])
  })
})

describe('DEC-145: pergunta singular no modo uma', () => {
  it('variantKindForAsk escolhe singular ou plural conforme o modo', () => {
    expect(
      variantKindForAsk({
        variantKind: 'tipo',
        variantKindPlural: 'tipos',
        variantSelection: 'uma',
      }),
    ).toBe('tipo')
    expect(
      variantKindForAsk({
        variantKind: 'zona',
        variantKindPlural: 'zonas',
        variantSelection: 'varias',
      }),
    ).toBe('zonas')
  })

  it('modo uma: «qual tipo?» sem «quais» nem «Pode ser mais de uma»', () => {
    const text = variantListQuestion('Massagem', 'tipo', MASSAGEM_TYPES, 'cnv_uma', {
      selectionMode: 'uma',
    })
    expect(text).toMatch(/\bqual tipo\b/i)
    expect(text).not.toMatch(/\bquais tipos?\b/i)
    expect(text).not.toMatch(/Pode ser mais de uma/i)
    expect(text).toMatch(/Liberação miofascial/)
  })

  it('modo varias: mantém «quais» / «Pode ser mais de uma»', () => {
    const text = variantListQuestion('Depilação', 'zonas', MASSAGEM_TYPES, 'cnv_varias', {
      selectionMode: 'varias',
    })
    expect(text).toMatch(/\bquais zonas\b/i)
    expect(text).not.toMatch(/\bqual zona\b/i)
  })
})