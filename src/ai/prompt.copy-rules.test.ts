/** DEC-090 — copy ao cliente: preço, buffer, sala, linha. */
import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, buildUserContent } from './prompt'
import type { AiGenerateInput } from './types'

function baseInput(): AiGenerateInput {
  return {
    kind: 'reply',
    context: {
      contactFirstName: 'Paulo',
      stage: null,
      services: [
        {
          name: 'Depilação',
          durationMinutes: 60,
          bufferMinutes: 15,
          priceCents: null,
          clientExplanation: null,
          audiencia: 'qualquer',
          professionalNames: ['Gi'],
          roomNames: ['Sala Depilação'],
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          zones: [
            { name: 'Axila', durationMinutes: 15, priceCents: 5_000, audience: 'masculino' },
            { name: 'Pernas', durationMinutes: 30, priceCents: 14_000, audience: 'masculino' },
          ],
        },
      ],
      messages: [{ direction: 'inbound', body: 'Tem horário amanhã?' }],
      hasClinicOutbound: true,
      clinicOutboundCount: 2,
      schedule: {
        serviceName: 'Depilação',
        dayLabel: 'quarta',
        period: null,
        audienceLine: 'masculino',
      },
    },
    warnings: [],
    servicesWithoutPrice: [],
    servicesWithoutExplanation: [],
    explanationSources: [],
    maxOutputTokens: 300,
    timeoutMs: 1000,
  } as unknown as AiGenerateInput
}

describe('DEC-090 regras de copy no prompt', () => {
  it('sistema: preço só se perguntar/final; sem buffer; sem sala; não reperguntar linha', () => {
    const system = buildSystemPrompt(baseInput())
    expect(system).toMatch(/só se a cliente perguntar|resumo final da proposta/i)
    expect(system).toMatch(/NUNCA mencione intervalo|NUNCA diga o nome da sala/i)
    expect(system).toMatch(/NÃO pergunte de novo/i)
    expect(system).not.toMatch(/diga o preço uma vez só/)
    expect(system).not.toMatch(/diga o intervalo uma vez: ele ocupa a agenda/)
  })

  it('catálogo ao modelo não inclui sala nem buffer; memória guarda a linha', () => {
    const user = buildUserContent(baseInput())
    expect(user).toContain('linha masculina')
    expect(user).toMatch(/não pergunte de novo.*linha/i)
    expect(user).not.toMatch(/Sala Depilação/)
    expect(user).not.toMatch(/intervalo depois|ocupa a agenda/)
    expect(user).toContain('Axila')
  })
})
