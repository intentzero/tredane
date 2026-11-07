import { describe, expect, it } from 'vitest'
import {
  classifyVariantPolarity,
  isCatalogInfoAsk,
  resolvePolarityVariantIds,
} from './booking-intent-text'
import type { ServiceZoneRow } from '../config/types'

const zones = [
  { id: 'z_ax', name: 'Axila', active: true },
  { id: 'z_pe', name: 'Pernas', active: true },
  { id: 'z_bu', name: 'Buço', active: true },
] as ServiceZoneRow[]

describe('classifyVariantPolarity — D3', () => {
  it('«não quero pernas, só axila» nega pernas e fica com axila', () => {
    const p = classifyVariantPolarity(
      'Na verdade não quero pernas, só axila',
      zones,
    )
    expect(p.hasNegation).toBe(true)
    expect(p.solo).toBe(true)
    expect(p.negatedIds).toEqual(['z_pe'])
    expect(p.positiveIds).toEqual(['z_ax'])
    expect(resolvePolarityVariantIds(p, ['z_ax', 'z_pe'])).toEqual(['z_ax'])
  })

  it('«Na verdade, só pernas» sem negação explícita substitui via só', () => {
    const p = classifyVariantPolarity('Na verdade, só pernas', zones)
    expect(p.solo).toBe(true)
    expect(p.positiveIds).toEqual(['z_pe'])
    expect(resolvePolarityVariantIds(p, ['z_ax', 'z_pe'])).toEqual(['z_pe'])
  })

  it('sem polaridade devolve null (parser habitual)', () => {
    const p = classifyVariantPolarity('Axila e pernas amanhã', zones)
    expect(p.hasNegation).toBe(false)
    expect(p.solo).toBe(false)
    expect(resolvePolarityVariantIds(p, ['z_ax'])).toBeNull()
  })
})

describe('isCatalogInfoAsk — D4', () => {
  it('reconhece pergunta de preço', () => {
    expect(isCatalogInfoAsk('Quanto custa pernas?')).toBe(true)
    expect(isCatalogInfoAsk('Quero marcar axila sexta')).toBe(false)
  })
})
