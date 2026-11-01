import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, buildUserContent } from './prompt'
import type { AiClinicContext, AiGenerateInput } from './types'

function input(clinic: Partial<AiClinicContext>, inbound: string): AiGenerateInput {
  return {
    kind: 'reply',
    context: {
      contactFirstName: 'Cliente',
      stage: null,
      services: [],
      messages: [{ direction: 'inbound', body: inbound }],
      hasClinicOutbound: false,
      clinicOutboundCount: 0,
      clinic: {
        name: 'Clínica Fictícia',
        address: 'Rua Fictícia, 123',
        timezone: 'America/Sao_Paulo',
        nowLabel: 'quarta, 28/10 às 10:00',
        today: '2026-10-28',
        openingHours: [],
        reschedulePolicy: null,
        cancellationPolicy: null,
        ...clinic,
      },
    },
    warnings: [],
    servicesWithoutPrice: [],
    servicesWithoutExplanation: [],
    explanationSources: [],
    maxOutputTokens: 300,
    timeoutMs: 1000,
  }
}

function fullPrompt(i: AiGenerateInput): string {
  return `${buildSystemPrompt(i)}\n${buildUserContent(i)}`
}

describe('prompt — link do Google Business', () => {
  it('inclui o link da clínica e a instrução de enviá-lo para localização', () => {
    const p = fullPrompt(
      input({ googleBusinessUrl: 'https://maps.app.goo.gl/ficticio123' }, 'Onde fica?'),
    )
    expect(p).toContain('https://maps.app.goo.gl/ficticio123')
    expect(p).toMatch(/localização ou como chegar/)
  })
  it('sem link cadastrado: não inventa link', () => {
    const p = fullPrompt(input({ googleBusinessUrl: null }, 'Onde fica?'))
    expect(p).toMatch(/Link de localização: \(não cadastrado/)
  })
  it('link vindo da cliente nunca vira link da clínica', () => {
    const p = fullPrompt(
      input({ googleBusinessUrl: null }, 'é aqui? https://golpe.example.com/mapa'),
    )
    expect(p).not.toMatch(/Link de localização \(Google Business[^\n]*golpe/)
  })
})
