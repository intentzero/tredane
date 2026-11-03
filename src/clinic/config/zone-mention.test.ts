/**
 * DEC-137 / #509 — plural leve e limiar na linha travada.
 * Sem fuzzy e sem cruzar género. Dados fictícios.
 */
import { describe, expect, it } from 'vitest'
import type { ServiceZoneRow } from './types'
import { resolveZoneMention } from './zones'

function zone(
  id: string,
  name: string,
  audience: ServiceZoneRow['audience'],
  synonyms: string[] = [],
): ServiceZoneRow {
  return {
    id,
    tenantId: 't',
    serviceId: 's',
    name,
    durationMinutes: 15,
    priceCents: 1000,
    audience,
    active: true,
    sortOrder: 0,
    synonyms,
  }
}

const feminine = [
  zone('ax-f', 'Axila', 'feminino'),
  zone('pe-f', 'Pernas', 'feminino'),
]
const both = [
  ...feminine,
  zone('ax-m', 'Axila', 'masculino'),
  zone('pe-m', 'Pernas', 'masculino'),
]

describe('resolveZoneMention (DEC-137 / #509)', () => {
  it('«Axilas e pernas» na linha feminina casa Axila e Pernas', () => {
    const got = resolveZoneMention('Axilas e pernas', feminine)
    expect(got.unrecognized).toBe(false)
    expect(got.leftover).toBeNull()
    expect(got.approx).toBe(true)
    expect(got.zones.map((z) => z.id)).toEqual(['ax-f', 'pe-f'])
  })

  it('não cruza masculino/feminino quando o âmbito tem os dois', () => {
    const got = resolveZoneMention('Axilas', both)
    expect(got.unrecognized).toBe(true)
    expect(got.zones).toEqual([])
    expect(got.leftover).toBe('axilas')
  })

  it('«Axila e cotovelo» não devolve o conjunto parcial', () => {
    const got = resolveZoneMention('Axila e cotovelo', feminine)
    expect(got.unrecognized).toBe(true)
    expect(got.zones).toEqual([])
    expect(got.leftover).toBe('cotovelo')
  })

  it('«Axila cotovelo» no mesmo segmento também não devolve parcial', () => {
    const got = resolveZoneMention('Axila cotovelo', feminine)
    expect(got.unrecognized).toBe(true)
    expect(got.zones).toEqual([])
    expect(got.leftover).toBe('cotovelo')
  })

  it('não faz fuzzy de nome diferente («axilha» ≠ Axila)', () => {
    const got = resolveZoneMention('axilha', feminine)
    expect(got.unrecognized).toBe(true)
    expect(got.zones).toEqual([])
    expect(got.leftover).toBe('axilha')
  })

  it('aceitar a hora não é sobra de zona', () => {
    const got = resolveZoneMention('Pode ser as 10:00 horas', feminine)
    expect(got.unrecognized).toBe(false)
    expect(got.leftover).toBeNull()
    expect(got.zones).toEqual([])
  })

  it('«10h» não esconde o plural nem vira sobra', () => {
    const got = resolveZoneMention('Axilas e pernas sexta às 10h', feminine)
    expect(got.unrecognized).toBe(false)
    expect(got.approx).toBe(true)
    expect(got.zones.map((z) => z.id)).toEqual(['ax-f', 'pe-f'])
  })

  it('nome exacto não marca approx', () => {
    const got = resolveZoneMention('Axila e pernas', feminine)
    expect(got.approx).toBe(false)
    expect(got.leftover).toBeNull()
    expect(got.zones.map((z) => z.name)).toEqual(['Axila', 'Pernas'])
  })

  it('sinónimo da ficha só no âmbito passado (DEC-110)', () => {
    const withSyn = [
      zone('lab-f', 'Lábio superior', 'feminino', ['buço']),
      zone('ax-f', 'Axila', 'feminino'),
    ]
    const got = resolveZoneMention('quero buço', withSyn)
    expect(got.unrecognized).toBe(false)
    expect(got.zones.map((z) => z.id)).toEqual(['lab-f'])
  })

  it('nome do serviço ignorado não vira sobra («Quero bronzeamento…»)', () => {
    const got = resolveZoneMention('Quero bronzeamento amanhã às 14:00', feminine, {
      ignoreWords: ['Bronzeamento'],
    })
    expect(got.unrecognized).toBe(false)
    expect(got.leftover).toBeNull()
    expect(got.zones).toEqual([])
  })

  it('«as duas» / «as três» não são sobra (atalho do catálogo)', () => {
    expect(resolveZoneMention('as duas', feminine)).toEqual({
      zones: [],
      approx: false,
      unrecognized: false,
      leftover: null,
    })
    expect(resolveZoneMention('as três', feminine).unrecognized).toBe(false)
    expect(resolveZoneMention('as tres', feminine).leftover).toBeNull()
  })

  it('propriedade: N zonas reconhecíveis → N ids ou unrecognized; nunca N−1', () => {
    const phrases: Array<{ text: string; expectIds: string[] | 'ask' }> = [
      { text: 'Axila', expectIds: ['ax-f'] },
      { text: 'Axilas e pernas', expectIds: ['ax-f', 'pe-f'] },
      { text: 'Axila e pernas', expectIds: ['ax-f', 'pe-f'] },
      { text: 'Axila e cotovelo', expectIds: 'ask' },
      { text: 'cotovelo', expectIds: 'ask' },
      { text: 'Pernas e axilha', expectIds: 'ask' },
    ]
    for (const { text, expectIds } of phrases) {
      const got = resolveZoneMention(text, feminine)
      if (expectIds === 'ask') {
        expect(got.unrecognized, text).toBe(true)
        expect(got.zones, text).toEqual([])
      } else {
        expect(got.unrecognized, text).toBe(false)
        expect(
          got.zones.map((z) => z.id),
          text,
        ).toEqual(expectIds)
      }
    }
  })
})
