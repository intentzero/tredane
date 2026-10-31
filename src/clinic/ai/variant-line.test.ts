import { describe, expect, it } from 'vitest'
import { stableVariantLabelList } from './variant-line'

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