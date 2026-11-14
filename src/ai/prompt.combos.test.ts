import { describe, expect, it } from 'vitest'
import { buildUserContent } from './prompt'
import { SimulatedAiAdapter } from './simulated/adapter'
import type { AiGenerateInput } from './types'

function input(inbound: string): AiGenerateInput {
  return {
    kind: 'reply',
    context: {
      contactFirstName: 'Cliente',
      stage: null,
      services: [
        {
          name: 'Depilação',
          durationMinutes: 60,
          priceCents: null,
          clientExplanation: null,
          audiencia: 'qualquer',
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          zones: [
            { name: 'Axila', durationMinutes: 15, priceCents: 5000, audience: 'ambos' },
            { name: 'Buço', durationMinutes: 15, priceCents: 3500, audience: 'feminino' },
            { name: 'Meia perna', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
          ],
          combos: [{ name: 'Buço + axila', zoneNames: ['Buço', 'Axila'], priceCents: 7000 }],
        },
      ],
      messages: [{ direction: 'inbound', body: inbound }],
      hasClinicOutbound: false,
      clinicOutboundCount: 0,
    },
    warnings: [],
    servicesWithoutPrice: [],
    servicesWithoutExplanation: [],
    explanationSources: [],
    maxOutputTokens: 300,
    timeoutMs: 1000,
  } as unknown as AiGenerateInput
}

describe('combos no contexto da IA (DEC-080)', () => {
  it('lista explicação por variante quando cadastrada (espelho DEC-046)', () => {
    const withExpl = input('o que é axila?')
    withExpl.context.services[0]!.zones = [
      {
        name: 'Axila',
        durationMinutes: 15,
        priceCents: 5000,
        audience: 'feminino',
        clientExplanation: 'Inclui a dobra.',
      },
      {
        name: 'Axila',
        durationMinutes: 20,
        priceCents: 6000,
        audience: 'masculino',
      },
    ]
    const text = buildUserContent(withExpl)
    expect(text).toMatch(/Axila: 15 min;.*gênero: feminino; explicação: Inclui a dobra/)
    expect(text).toMatch(/Axila: 20 min;.*gênero: masculino; explicação: \(não cadastrada\)/)
  })

  it('lista o combo com as variantes e o preço, e diz que o valor final é do sistema', () => {
    const text = buildUserContent(input('quanto custa?'))
    expect(text).toContain('combo «Buço + axila»')
    expect(text).toContain('Buço + Axila')
    expect(text).toMatch(/R\$\s?70,00/)
    expect(text).toContain('o valor final é o do sistema')
  })

  it('a resposta simulada cita o total com o combo, não a soma', async () => {
    const adapter = new SimulatedAiAdapter()
    const out = await adapter.generate(input('quanto custa a depilação de axila e buço?'))
    expect(JSON.stringify(out)).toMatch(/R\$\s?70,00/)
    expect(JSON.stringify(out)).not.toMatch(/R\$\s?85,00/)
  })
})
