import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter, type AiGenerateInput, type AiGenerateResult } from '../../../../ai'
import { CLASSIFY_TOOL_NAME, classifyIntentWithLlm, parseClassification } from './llm-classifier'

class StubAdapter extends SimulatedAiAdapter {
  seen: AiGenerateInput | null = null
  constructor(private readonly text: string) {
    super()
  }
  override async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    this.seen = input
    const r = await super.generate(input)
    return r.ok ? { ...r, text: this.text } : r
  }
}

describe('classificador de intenção por LLM (protótipo de avaliação)', () => {
  it('aceita só classes do conjunto fechado e confiança entre 0 e 1', () => {
    expect(parseClassification('{"classe":"agendar","confianca":0.9}')).toMatchObject({ label: 'agendar', confidence: 0.9 })
    expect(parseClassification('{"classe":"informacao","confianca":0.7}')).toMatchObject({ label: 'nenhum' })
    expect(parseClassification('{"classe":"misto","confianca":1}')?.label).toBe('misto')
    expect(parseClassification('{"classe":"marcar_agora","confianca":0.9}')).toBeNull()
    expect(parseClassification('{"classe":"agendar","confianca":2}')).toBeNull()
    expect(parseClassification('não é json')).toBeNull()
  })

  it('pede uma ferramenta de saída fechada e não passa dados da clínica nem da cliente', async () => {
    const adapter = new StubAdapter('{"classe":"remarcar","confianca":0.8}')
    const out = await classifyIntentWithLlm(adapter, 'preciso mudar meu dia')
    expect(out.result).toMatchObject({ label: 'remarcar' })
    expect(adapter.seen?.toolChoice).toEqual({ type: 'tool', name: CLASSIFY_TOOL_NAME })
    expect(adapter.seen?.context.messages).toEqual([])
    expect(adapter.seen?.userContentOverride).toBe('Mensagem da cliente:\npreciso mudar meu dia')
  })

  it('saída inválida do modelo dá null (o chamador cai no comportamento de hoje)', async () => {
    const out = await classifyIntentWithLlm(new StubAdapter('{"classe":"x"}'), 'oi')
    expect(out.result).toBeNull()
  })
})
