import { describe, expect, it } from 'vitest'
import {
  currentClientTurnText,
  explicitAudienceLine,
  filterServicesForLine,
  isServiceAudience,
  normalizeServiceAudience,
  serviceMatchesAudience,
} from './audience'

describe('audiência do serviço (DEC-075 / S2)', () => {
  it('não promove nome com «feminino» a audiência', () => {
    expect(normalizeServiceAudience(undefined)).toBe('qualquer')
    expect(normalizeServiceAudience('Bronzeamento feminino')).toBe('qualquer')
    expect(isServiceAudience('qualquer')).toBe(true)
    expect(isServiceAudience('misto')).toBe(false)
  })

  it('pedido explícito de linha: só um sexo; ambos ou nenhum → null', () => {
    expect(explicitAudienceLine('quero o bronzeamento feminino')).toBe('feminino')
    expect(explicitAudienceLine('Masculino, por favor')).toBe('masculino')
    expect(explicitAudienceLine('quero bronzeamento')).toBeNull()
    expect(explicitAudienceLine('feminino ou masculino')).toBeNull()
  })

  it('filtra linha pedida + qualquer; não grava preferência', () => {
    const catalog = [
      { name: 'Depilação', audiencia: 'qualquer' as const },
      { name: 'Bronze feminino', audiencia: 'feminino' as const },
      { name: 'Bronze masculino', audiencia: 'masculino' as const },
    ]
    expect(filterServicesForLine(catalog, 'feminino').map((s) => s.name)).toEqual([
      'Depilação',
      'Bronze feminino',
    ])
    expect(filterServicesForLine(catalog, null)).toHaveLength(3)
    expect(serviceMatchesAudience('qualquer', 'masculino')).toBe(true)
    expect(serviceMatchesAudience('feminino', 'masculino')).toBe(false)
  })

  it('turno da cliente = inbound desde a última outbound', () => {
    const text = currentClientTurnText([
      { direction: 'inbound', body: 'oi' },
      { direction: 'outbound', body: 'olá' },
      { direction: 'inbound', body: 'quero o feminino' },
      { direction: 'inbound', body: 'hoje' },
    ])
    expect(text).toBe('quero o feminino\nhoje')
  })
})

describe('currentClientTurnText com janela de tempo', () => {
  const H = 60 * 60 * 1000
  it('uma pergunta de ontem sem resposta não se junta ao «Oi» de hoje', () => {
    const text = currentClientTurnText([
      { direction: 'inbound', body: 'mas e o parcelamento??', createdAt: 1000 },
      { direction: 'inbound', body: 'Oi', createdAt: 1000 + 24 * H },
    ])
    expect(text).toBe('Oi')
  })
  it('mensagens seguidas continuam no mesmo turno', () => {
    const text = currentClientTurnText([
      { direction: 'inbound', body: 'quero marcar', createdAt: 1000 },
      { direction: 'inbound', body: 'amanhã', createdAt: 1000 + 5 * 60 * 1000 },
    ])
    expect(text).toBe('quero marcar\namanhã')
  })
  it('sem createdAt mantém o comportamento anterior', () => {
    expect(
      currentClientTurnText([
        { direction: 'inbound', body: 'a' },
        { direction: 'inbound', body: 'b' },
      ]),
    ).toBe('a\nb')
  })
})
