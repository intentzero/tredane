import { describe, expect, it } from 'vitest'
import {
  applyDraftContinuity,
  countClinicOutbound,
  hasClinicOutbound,
  startsWithGreeting,
  stripLeadingGreeting,
} from './continuity'
import { buildSystemPrompt, buildUserContent } from './prompt'
import type { AiGenerateInput } from './types'

function replyInput(
  messages: AiGenerateInput['context']['messages'],
  extras: Partial<AiGenerateInput['context']> = {},
): AiGenerateInput {
  const outbound = countClinicOutbound(messages)
  return {
    kind: 'reply',
    context: {
      contactFirstName: 'Paulo',
      stage: null,
      services: [],
      messages,
      hasClinicOutbound: outbound > 0,
      clinicOutboundCount: outbound,
      ...extras,
    },
    warnings: [],
    servicesWithoutPrice: [],
    servicesWithoutExplanation: [],
    explanationSources: [],
    maxOutputTokens: 400,
    timeoutMs: 1000,
  }
}

describe('continuidade conversacional dos rascunhos', () => {
  it('detecta outbound da clínica no histórico', () => {
    expect(hasClinicOutbound([{ direction: 'inbound', body: 'Oi' }])).toBe(false)
    expect(
      hasClinicOutbound([
        { direction: 'inbound', body: 'Oi' },
        { direction: 'outbound', body: 'Oi, Paulo!' },
      ]),
    ).toBe(true)
    expect(
      countClinicOutbound([
        { direction: 'outbound', body: 'a' },
        { direction: 'inbound', body: 'b' },
        { direction: 'outbound', body: 'c' },
      ]),
    ).toBe(2)
  })

  it.each([
    'Oi, Paulo!',
    'Olá!',
    'Ola Ana',
    'Bom dia, Carla.',
    'Boa tarde!',
    'Boa noite Paulo',
    '  oi!',
  ])('reconhece cumprimento de abertura «%s»', (g) => {
    expect(startsWithGreeting(g)).toBe(true)
  })

  it.each([
    'Tenho sim, Paulo! Amanhã às 15:00.',
    'Claro! Qual dia fica melhor?',
    'Para bronzeamento masculino tenho…',
  ])('não trata como cumprimento «%s»', (t) => {
    expect(startsWithGreeting(t)).toBe(false)
  })

  it('stripLeadingGreeting remove «Oi, Paulo!» e capitaliza o resto', () => {
    expect(stripLeadingGreeting('Oi, Paulo!\n\ntenho horário amanhã às 15:00.')).toBe(
      'Tenho horário amanhã às 15:00.',
    )
    expect(stripLeadingGreeting('Oi, Paulo! 😊\n\nObrigada pelo retorno!')).toBe(
      'Obrigada pelo retorno!',
    )
    expect(stripLeadingGreeting('Olá! Claro, vejo isso.')).toBe('Claro, vejo isso.')
    // Só cumprimento → mantém (não esvazia o rascunho)
    expect(stripLeadingGreeting('Oi, Paulo!')).toBe('Oi, Paulo!')
  })

  it('applyDraftContinuity: com outbound → corta cumprimento; sem outbound → mantém', () => {
    const mid = [
      { direction: 'inbound' as const, body: 'Oi' },
      { direction: 'outbound' as const, body: 'Oi, Paulo! Tudo bem…' },
      { direction: 'inbound' as const, body: 'Quero bronzeamento masculino' },
    ]
    expect(applyDraftContinuity('Oi, Paulo!\n\nPara bronzeamento masculino…', mid)).toBe(
      'Para bronzeamento masculino…',
    )
    expect(
      applyDraftContinuity('Oi, Paulo!\n\nPosso ajudar?', [{ direction: 'inbound', body: 'Oi' }]),
    ).toBe('Oi, Paulo!\n\nPosso ajudar?')
  })

  it('prompt: primeiro contacto → sinaliza cumprimento ok e exemplos com Oi', () => {
    const i = replyInput([{ direction: 'inbound', body: 'Oi, tem horário?' }])
    const system = buildSystemPrompt(i)
    const user = buildUserContent(i)
    expect(system).toMatch(/Continuidade/)
    expect(system).toMatch(/NÃO recomece com cumprimento/)
    expect(user).toMatch(/ainda não há mensagem da clínica/)
    expect(user).not.toMatch(/NÃO comece com «Oi»/)
  })

  it('prompt: já houve outbound → pede continuidade sem re-cumprimentar (caso Paulo)', () => {
    const i = replyInput([
      { direction: 'inbound', body: 'Oi' },
      { direction: 'outbound', body: 'Oi, Paulo! Tudo bem…' },
      { direction: 'inbound', body: 'Tem horário de bronzeamento masculino?' },
    ])
    const system = buildSystemPrompt(i)
    const user = buildUserContent(i)
    expect(system).toMatch(/Continuidade/)
    expect(user).toMatch(/clínica JÁ enviou/)
    expect(user).toMatch(/NÃO comece com «Oi»/)
    expect(user).toMatch(/sem re-cumprimentar/)
    // Exemplo mid-thread sem cumprimento de abertura na mensagem sugerida
    expect(system).toContain('[clínica] Oi, Ana!')
    expect(system).toMatch(/"mensagem": "Tem sim!/)
  })
})
