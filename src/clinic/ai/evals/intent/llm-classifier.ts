/**
 * Protótipo de classificador de intenção por LLM (DEC-202, medição de 18/11/2026). **Só avaliação:**
 * não está ligado à produção. Devolve uma classe de um conjunto fechado e uma confiança; nunca
 * escolhe serviço, hora nem marcação. Mede se vale a pena acrescentar isto ao léxico.
 */
import {
  AI_MAX_OUTPUT_TOKENS_REPLY,
  AI_MODEL_EXCEPTION,
  AI_TIMEOUT_MS,
  type AiProviderAdapter,
} from '../../../../ai'
import type { IntentLabel } from './corpus'

export const CLASSIFY_TOOL_NAME = 'classificar_intencao'
const CLASSES = ['agendar', 'remarcar', 'cancelar', 'misto', 'informacao', 'outro'] as const
export type LlmIntentClass = (typeof CLASSES)[number]

export const CLASSIFIER_SYSTEM = [
  'Você classifica a mensagem de uma cliente de uma clínica de estética que escreve por WhatsApp.',
  'Responda SÓ chamando a ferramenta, com a classe e a confiança (0 a 1). Não escreva texto.',
  'Classes:',
  '- agendar: quer marcar, pergunta por vaga ou horário livre para ela.',
  '- remarcar: quer mudar o dia ou a hora de uma marcação que já tem.',
  '- cancelar: quer desmarcar ou desistir de uma marcação que já tem.',
  '- misto: pergunta informação (preço, duração, o que é) E quer marcar, na mesma mensagem.',
  '- informacao: pergunta sobre a clínica, os procedimentos, preços, horário de funcionamento, política, pagamento.',
  '- outro: agradecimento, conversa, ou nada disto.',
  'Perguntar sobre a política de cancelar ou remarcar («tem multa?», «cobram?») é informacao, não cancelar nem remarcar.',
  'Na dúvida entre agendar e informacao, prefira agendar.',
].join('\n')

export const CLASSIFY_TOOL = {
  name: CLASSIFY_TOOL_NAME,
  description: 'Regista a classe da mensagem e a confiança.',
  input_schema: {
    type: 'object',
    properties: {
      classe: { type: 'string', enum: [...CLASSES] },
      confianca: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['classe', 'confianca'],
    additionalProperties: false,
  },
}

export type LlmClassification = { label: IntentLabel; confidence: number; raw: LlmIntentClass }

/** Valida a saída do modelo contra o conjunto fechado; `null` se inválida. */
export function parseClassification(text: string): LlmClassification | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const raw = o.classe
  const conf = o.confianca
  if (typeof raw !== 'string' || !(CLASSES as readonly string[]).includes(raw)) return null
  if (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1) return null
  const label: IntentLabel =
    raw === 'informacao' || raw === 'outro' ? 'nenhum' : (raw as 'agendar' | 'remarcar' | 'cancelar' | 'misto')
  return { label, confidence: conf, raw: raw as LlmIntentClass }
}

export async function classifyIntentWithLlm(
  adapter: AiProviderAdapter,
  text: string,
): Promise<{ result: LlmClassification | null; inputTokens: number | null; outputTokens: number | null; model: string | null }> {
  const gen = await adapter.generate({
    kind: 'reply',
    profile: 'extract',
    context: {
      contactFirstName: null,
      stage: null,
      services: [],
      messages: [],
      hasClinicOutbound: false,
      clinicOutboundCount: 0,
    },
    warnings: [],
    servicesWithoutPrice: [],
    servicesWithoutExplanation: [],
    explanationSources: [],
    maxOutputTokens: Math.min(128, AI_MAX_OUTPUT_TOKENS_REPLY),
    timeoutMs: AI_TIMEOUT_MS,
    model: AI_MODEL_EXCEPTION,
    systemPromptOverride: CLASSIFIER_SYSTEM,
    userContentOverride: `Mensagem da cliente:\n${text}`,
    tools: [CLASSIFY_TOOL],
    toolChoice: { type: 'tool', name: CLASSIFY_TOOL_NAME },
    promptCache: true,
  })
  if (!gen.ok) return { result: null, inputTokens: null, outputTokens: null, model: gen.model ?? null }
  return {
    result: parseClassification(gen.text),
    inputTokens: gen.inputTokens,
    outputTokens: gen.outputTokens,
    model: gen.model,
  }
}
