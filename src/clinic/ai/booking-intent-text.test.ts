import { describe, expect, it } from 'vitest'
import {
  classifyVariantPolarity,
  isCatalogInfoAsk,
  isShortBookingAffirm,
  resolvePolarityVariantIds,
} from './booking-intent-text'
import type { ServiceZoneRow } from '../config/types'

const zones = [
  { id: 'z_ax', name: 'Axila', active: true },
  { id: 'z_pe', name: 'Pernas', active: true },
  { id: 'z_bu', name: 'Buço', active: true },
  { id: 'z_or', name: 'Orelha', active: true },
] as ServiceZoneRow[]

const todasPrior = ['z_ax', 'z_pe', 'z_bu', 'z_or']

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

  it('cue sem zona («só amanhã») não engole o turno', () => {
    const p = classifyVariantPolarity('só amanhã', zones)
    expect(p.solo).toBe(true)
    expect(p.positiveIds).toEqual([])
    expect(resolvePolarityVariantIds(p, ['z_ax', 'z_pe'])).toBeNull()
  })

  it('«não quero só pernas» nega pernas (só sob a negação)', () => {
    const p = classifyVariantPolarity('não quero só pernas', zones)
    expect(p.hasNegation).toBe(true)
    expect(p.negatedIds).toEqual(['z_pe'])
    expect(p.positiveIds).toEqual([])
    expect(resolvePolarityVariantIds(p, ['z_ax', 'z_pe'])).toEqual(['z_ax'])
  })

  it.each(['Sem orelha', 'sem a orelha', 'tirar orelha', 'tira a orelha'])(
    '«%s» remove Orelha do conjunto Todas — não fica só Orelha',
    (text) => {
      const p = classifyVariantPolarity(text, zones)
      expect(p.hasNegation).toBe(true)
      expect(p.negatedIds).toEqual(['z_or'])
      expect(p.positiveIds).toEqual([])
      expect(resolvePolarityVariantIds(p, todasPrior)).toEqual([
        'z_ax',
        'z_pe',
        'z_bu',
      ])
    },
  )

  it('«quero tirar uma dúvida» sem zona não engole o turno', () => {
    const p = classifyVariantPolarity('quero tirar uma dúvida', zones)
    expect(p.negatedIds).toEqual([])
    expect(p.positiveIds).toEqual([])
    expect(resolvePolarityVariantIds(p, todasPrior)).toBeNull()
  })

  it('«sem pressa» sem zona contígua não engole o turno', () => {
    const p = classifyVariantPolarity('sem pressa', zones)
    expect(p.hasNegation).toBe(false)
    expect(resolvePolarityVariantIds(p, todasPrior)).toBeNull()
  })
})

describe('isCatalogInfoAsk — D4', () => {
  it('reconhece pergunta de preço', () => {
    expect(isCatalogInfoAsk('Quanto custa pernas?')).toBe(true)
    expect(isCatalogInfoAsk('Quanto custa?')).toBe(true)
    expect(isCatalogInfoAsk('quais os valores?')).toBe(true)
    expect(isCatalogInfoAsk('qual o preço?')).toBe(true)
    expect(isCatalogInfoAsk('Quero marcar axila sexta')).toBe(false)
  })
})

describe('isShortBookingAffirm — bridge pós-cotação', () => {
  it('aceita «Quero» e sinónimos curtos; rejeita pedido com zona/dia', () => {
    expect(isShortBookingAffirm('Quero')).toBe(true)
    expect(isShortBookingAffirm('quero marcar')).toBe(true)
    expect(isShortBookingAffirm('Pode ser')).toBe(true)
    expect(isShortBookingAffirm('não quero')).toBe(false)
    expect(isShortBookingAffirm('Quero marcar axila sexta')).toBe(false)
  })
})
