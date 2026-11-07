/**
 * DEC-137 / #509 — plural leve e limiar na linha travada.
 * Sem fuzzy e sem cruzar género. Dados fictícios.
 */
import { describe, expect, it } from 'vitest'
import type { ServiceZoneRow } from './types'
import { resolveZoneMention, textNamesMixAudiences, zonesNamedInText } from './zones'

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

  it('zona composta não parte no «e» («tórax e abdômen» / sem acento)', () => {
    const masculine = [
      zone('ax', 'Axila', 'masculino'),
      zone('pe', 'Pernas', 'masculino'),
      zone('tx', 'Tórax e Abdômen', 'masculino'),
      zone('co', 'Costas', 'masculino'),
      zone('br', 'Braços', 'masculino'),
      zone('in', 'Intima', 'masculino'),
      zone('or', 'Orelha', 'masculino'),
    ]
    for (const text of ['Axilas pernas e tórax e abdômen', 'Axilas pernas e torax e abdomen']) {
      const got = resolveZoneMention(text, masculine)
      expect(got.unrecognized, text).toBe(false)
      expect(got.leftover, text).toBeNull()
      expect(got.zones.map((z) => z.name), text).toEqual(['Axila', 'Pernas', 'Tórax e Abdômen'])
    }
    const alone = resolveZoneMention('torax e abdomen', masculine)
    expect(alone.unrecognized).toBe(false)
    expect(alone.approx).toBe(false)
    expect(alone.zones.map((z) => z.name)).toEqual(['Tórax e Abdômen'])
  })

  it('zona composta mais uma sobra não devolve o parcial', () => {
    const masculine = [
      zone('tx', 'Tórax e Abdômen', 'masculino'),
      zone('ax', 'Axila', 'masculino'),
    ]
    const got = resolveZoneMention('tórax e abdômen e cotovelo', masculine)
    expect(got.unrecognized).toBe(true)
    expect(got.zones).toEqual([])
    expect(got.leftover).toBe('cotovelo')
  })

  it('forma de hora consumida pelo relógio único não é sobra (DEC-137, 06/11/2026)', () => {
    for (const text of [
      '10hrs',
      '10hs',
      'lá pelas 10',
      'por volta das 10',
      '9 e meia',
      'meio-dia',
      'o das 10',
      'Pode ser às 10 então',
      'Sexta às 10, valeu',
      'Prefiro às 10',
    ]) {
      const got = resolveZoneMention(text, feminine)
      expect(got.unrecognized, text).toBe(false)
      expect(got.leftover, text).toBeNull()
    }
  })

  it('«Na verdade, só pernas» resolve Pernas e não trata «verdade» como zona', () => {
    const got = resolveZoneMention('Na verdade, só pernas', feminine)
    expect(got.unrecognized).toBe(false)
    expect(got.leftover).toBeNull()
    expect(got.zones.map((z) => z.name)).toEqual(['Pernas'])
  })

  it('«0900» no texto de horário não é sobra de zona', () => {
    for (const text of ['Sexta às 0900', '0900', 'sexta as 09:00']) {
      const got = resolveZoneMention(text, feminine)
      expect(got.unrecognized, text).toBe(false)
      expect(got.leftover, text).toBeNull()
      expect(got.zones, text).toEqual([])
    }
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

/** Serviço Massagem aberto: o nome do serviço não escolhe variante (Paulo 07/11/2026). */
const massagemZones = [
  zone('lib', 'Liberação miofascial', 'ambos'),
  zone('ven', 'Ventosaterapia', 'ambos'),
  zone('dre', 'Drenagem linfática', 'ambos'),
  zone('rel', 'Massagem relaxante', 'ambos'),
]

describe('nome do serviço ≠ variante (Paulo 07/11/2026)', () => {
  const ignore = { ignoreWords: ['Massagem'] }

  it('«Bom dia, queria agendar uma massagem» não escolhe Massagem relaxante nem sobra', () => {
    const got = resolveZoneMention('Bom dia, queria agendar uma massagem', massagemZones, ignore)
    expect(got.unrecognized).toBe(false)
    expect(got.leftover).toBeNull()
    expect(got.zones).toEqual([])
    expect(zonesNamedInText('Bom dia, queria agendar uma massagem', massagemZones, ignore)).toEqual([])
  })

  it('«massagem relaxante» / «Massagem relaxante» escolhe essa zona', () => {
    for (const text of ['massagem relaxante', 'Massagem relaxante']) {
      const got = resolveZoneMention(text, massagemZones, ignore)
      expect(got.unrecognized, text).toBe(false)
      expect(got.zones.map((z) => z.id), text).toEqual(['rel'])
    }
  })

  it('palavra distintiva «relaxante» (única) escolhe Massagem relaxante', () => {
    const got = resolveZoneMention('quero a relaxante', massagemZones, ignore)
    expect(got.unrecognized).toBe(false)
    expect(got.zones.map((z) => z.id)).toEqual(['rel'])
  })

  it('zona desconhecida «cotovelo» continua unrecognized com leftover', () => {
    const got = resolveZoneMention('quero cotovelo', massagemZones, ignore)
    expect(got.unrecognized).toBe(true)
    expect(got.zones).toEqual([])
    expect(got.leftover).toBe('cotovelo')
  })

  it('regressão: «íntima» continua a casar Parte íntima (depilação)', () => {
    const depil = [
      zone('ax-f', 'Axila', 'feminino'),
      zone('pe-f', 'Pernas', 'feminino'),
      zone('in-f', 'Parte íntima', 'feminino'),
    ]
    const got = resolveZoneMention('axila e íntima', depil, { ignoreWords: ['Depilação'] })
    expect(got.unrecognized).toBe(false)
    expect(got.zones.map((z) => z.name)).toEqual(['Axila', 'Parte íntima'])
    expect(zonesNamedInText('só a íntima', depil, { ignoreWords: ['Depilação'] }).map((z) => z.id)).toEqual([
      'in-f',
    ])
  })

  it('artigo «uma» e «serviço» não são sobra unrecognized', () => {
    for (const text of ['uma massagem', 'quero o serviço', 'uns horários']) {
      const got = resolveZoneMention(text, massagemZones, ignore)
      expect(got.unrecognized, text).toBe(false)
      expect(got.leftover, text).toBeNull()
      expect(got.zones, text).toEqual([])
    }
  })
})

describe('textNamesMixAudiences (CF-43)', () => {
  const axF = { name: 'Axila', audience: 'feminino' as const }
  const axM = { name: 'Axila', audience: 'masculino' as const }
  const pernasF = { name: 'Pernas', audience: 'feminino' as const }
  const barbaM = { name: 'Barba', audience: 'masculino' as const }
  it('homónimo F+M sem palavra de linha é ambíguo, não mistura', () => {
    expect(textNamesMixAudiences('quero depilar a axila', [axF, axM])).toBe(false)
  })
  it('mistura explícita de linhas continua a ser mistura (D-04)', () => {
    expect(textNamesMixAudiences('axila masculina e pernas femininas', [axM, pernasF])).toBe(true)
  })
  it('nomes únicos de linhas diferentes são mistura', () => {
    expect(textNamesMixAudiences('barba e pernas', [barbaM, pernasF])).toBe(true)
  })
  it('homónimo com nome único de uma linha não é mistura', () => {
    expect(textNamesMixAudiences('axila e barba', [axF, axM, barbaM])).toBe(false)
  })
})
