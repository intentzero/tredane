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

  it('extrai tool_use e envia cache_control no bloco estável (#416)', async () => {
    let captured: { system?: unknown; tools?: Array<{ cache_control?: { type: string } }> } = {}
    const pending = adapter(async (_url, init) => {
      captured = JSON.parse(String(init?.body ?? '{}')) as typeof captured
      return new Response(
        JSON.stringify({
          content: [
            {
              type: 'tool_use',
              name: 'extract_turn_slots',
              input: { acts: ['marcar'], serviceId: 'svc_a' },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const result = await pending.generate({
      ...input(1_000),
      profile: 'extract',
      systemPromptOverride: 'stable',
      userContentOverride: 'turno',
      promptCache: true,
      tools: [
        {
          name: 'extract_turn_slots',
          description: 'x',
          input_schema: { type: 'object', properties: {} },
        },
      ],
      toolChoice: { type: 'tool', name: 'extract_turn_slots' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.toolName).toBe('extract_turn_slots')
      expect(JSON.parse(result.text)).toEqual({ acts: ['marcar'], serviceId: 'svc_a' })
    }
    expect(captured.system).toEqual([
      { type: 'text', text: 'stable', cache_control: { type: 'ephemeral' } },
    ])
    expect(captured.tools?.[0]?.cache_control).toEqual({ type: 'ephemeral' })
  })
})
