import { describe, expect, it } from 'vitest'
import { AiGatewayAnthropicAdapter } from './anthropic'
import type { AiGenerateInput } from '../types'

function input(timeoutMs: number): AiGenerateInput {
  return {
    kind: 'reply',
    context: {
      contactFirstName: 'Cliente',
      stage: null,
      services: [],
      messages: [{ direction: 'inbound', body: 'Axila' }],
      hasClinicOutbound: true,
      clinicOutboundCount: 1,
    },
    warnings: [],
    servicesWithoutPrice: [],
    servicesWithoutExplanation: [],
    explanationSources: [],
    maxOutputTokens: 64,
    timeoutMs,
  }
}

function adapter(fetchImpl: typeof fetch): AiGatewayAnthropicAdapter {
  return new AiGatewayAnthropicAdapter({
    accountId: 'account',
    gatewayId: 'gateway',
    gatewayToken: 'token-de-teste',
    fetchImpl,
  })
}

describe('AiGatewayAnthropicAdapter', () => {
  it('não espera um fetch que ignora o abort', async () => {
    const pending = adapter(() => new Promise<Response>(() => {}))
    const started = Date.now()
    const result = await pending.generate(input(50))
    const elapsed = Date.now() - started
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('timeout')
    expect(elapsed).toBeLessThan(1_500)
  })

  it('aceita a resposta quando o fetch volta dentro do prazo', async () => {
    const pending = adapter(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'Qual horário fica melhor?' }],
            usage: { input_tokens: 3, output_tokens: 4 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    const result = await pending.generate(input(1_000))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.text).toBe('Qual horário fica melhor?')
      expect(result.outputTokens).toBe(4)
    }
  })
})
