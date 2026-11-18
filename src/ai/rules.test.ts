import { describe, expect, it } from 'vitest'
import { analyzeContentRules } from './rules'

describe('analyzeContentRules — no_price', () => {
  const depilacao = {
    name: 'Depilação',
    durationMinutes: 60,
    priceCents: null,
    clientExplanation: null,
    audiencia: 'qualquer' as const,
    zones: [
      { name: 'Axila', durationMinutes: 15, priceCents: 4_000, audience: 'masculino' as const },
      { name: 'Pernas', durationMinutes: 30, priceCents: 14_000, audience: 'masculino' as const },
    ],
  }

  it('não sinaliza no_price quando todas as variantes da linha têm preço', () => {
    const hit = analyzeContentRules(
      [{ direction: 'inbound', body: 'Masculina' }],
      [depilacao],
    )
    expect(hit.warnings).not.toContain('no_price')
  })

  it('sinaliza no_price quando alguma variante citada não tem preço', () => {
    const hit = analyzeContentRules(
      [{ direction: 'inbound', body: 'quanto custa depilação na axila?' }],
      [
        {
          ...depilacao,
          zones: [
            { name: 'Axila', durationMinutes: 15, priceCents: null, audience: 'masculino' as const },
          ],
        },
      ],
    )
    expect(hit.warnings).toContain('no_price')
  })

  it('não sinaliza no_price em pergunta genérica se todas as zonas têm preço cadastrado', () => {
    const hit = analyzeContentRules(
      [{ direction: 'inbound', body: 'Quais os valores da depilação?' }],
      [
        {
          ...depilacao,
          zones: [
            ...depilacao.zones,
            { name: 'Axila', durationMinutes: 15, priceCents: 4_000, audience: 'feminino' as const },
          ],
        },
      ],
    )
    expect(hit.warnings).not.toContain('no_price')
  })
})