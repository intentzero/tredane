/**
 * DEC-137 — plural leve na linha travada. Sem fuzzy e sem cruzar género.
 * Dados fictícios.
 */
import { describe, expect, it } from 'vitest'
import type { ServiceZoneRow } from './types'
import { resolveZoneMention } from './zones'

function zone(
  id: string,
  name: string,
  audience: ServiceZoneRow['audience'],
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
    synonyms: [],
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

describe('resolveZoneMention (DEC-137)', () => {
  it('«Axilas e pernas» na linha feminina casa Axila e Pernas', () => {
    const got = resolveZoneMention('Axilas e pernas', feminine)
    expect(got.unrecognized).toBe(false)
    expect(got.approx).toBe(true)
    expect(got.zones.map((z) => z.id)).toEqual(['ax-f', 'pe-f'])
  })

  it('não cruza masculino/feminino quando o âmbito tem os dois', () => {
    const got = resolveZoneMention('Axilas', both)
    expect(got.zones).toEqual([])
  })

  it('«Axila e cotovelo» não devolve o conjunto parcial', () => {
    const got = resolveZoneMention('Axila e cotovelo', feminine)
    expect(got.unrecognized).toBe(true)
    expect(got.zones).toEqual([])
  })

  it('não faz fuzzy de nome diferente («axilha» ≠ Axila)', () => {
    const got = resolveZoneMention('axilha', feminine)
    expect(got.zones).toEqual([])
  })

  it('aceitar a hora não é sobra de zona', () => {
    const got = resolveZoneMention('Pode ser as 10:00 horas', feminine)
    expect(got.unrecognized).toBe(false)
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
    expect(got.zones.map((z) => z.name)).toEqual(['Axila', 'Pernas'])
  })
})
