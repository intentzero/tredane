/**
 * Classificador de intenção por LLM (DEC-202 / DEC-221 — só staging, atrás de
 * `INTENT_LLM_ENABLED`). Devolve uma **etiqueta** de um conjunto fechado e uma confiança;
 * nunca redige a resposta, nunca escolhe serviço/hora/marcação, e nunca desliga um ramo de
 * segurança. O backend monta frase + CTA a partir da etiqueta (handlers determinísticos).
 * Perguntas abertas (`informacao` / `outro` → `nenhum`) seguem o redator + validador.
 */
import {
  AI_MAX_OUTPUT_TOKENS_REPLY,
  AI_MODEL_EXCEPTION,
  AI_TIMEOUT_MS,
  type AiProviderAdapter,
} from './index'

/** Etiquetas estáveis que o backend trata (fechadas) ou `nenhum` (aberta → redator). */
export type IntentLabel =
  | 'agendar'
  | 'remarcar'
  | 'cancelar'
  | 'misto'
  | 'price'
  | 'team'
  | 'faq_catalog'
  | 'faq_clinic'
  | 'nenhum'

export const CLASSIFY_TOOL_NAME = 'classificar_intencao'

/** Classes pedidas ao modelo (inclui abertas; o parse mapeia abertas → `nenhum`). */
export const INTENT_CLASSES = [
  'agendar',
  'remarcar',
  'cancelar',
  'misto',
  'price',
  'team',
  'faq_catalog',
  'faq_clinic',
  'informacao',
  'outro',
] as const
export type LlmIntentClass = (typeof INTENT_CLASSES)[number]

/** Intents fechados: léxico ou classificador → handler; o redator não toca. */
export const CLOSED_INTENT_LABELS = [
  'agendar',
  'remarcar',
  'cancelar',
  'misto',
  'price',
  'team',
  'faq_catalog',
  'faq_clinic',
] as const satisfies ReadonlyArray<Exclude<IntentLabel, 'nenhum'>>

export type ClosedIntentLabel = (typeof CLOSED_INTENT_LABELS)[number]

export const CLASSIFIER_SYSTEM = [
  'Você classifica a mensagem de uma cliente de uma clínica de estética que escreve por WhatsApp.',
  'Responda SÓ chamando a ferramenta, com a classe e a confiança (0 a 1). Não escreva texto.',
  'Classes:',
  '- agendar: quer marcar, pergunta por vaga, horário livre, ou ver a agenda para ela.',
  '- remarcar: quer mudar o dia ou a hora de uma marcação que já tem.',
  '- cancelar: quer desmarcar ou desistir de uma marcação que já tem.',
  '- misto: pergunta informação (preço, duração, o que é) E quer marcar, na mesma mensagem.',
  '- price: pergunta só preço ou valor de um serviço/procedimento (sem pedir marcar).',
  '- team: quer falar com uma pessoa, atendente ou a equipe (não é dúvida de catálogo).',
  '- faq_catalog: clarificação ou oferta de serviço/variante (o que inclui / como é / o que cobre / fazem X? / têm X?); também expediente, lista de serviços, política de remarcação/cancelamento ou localização da clínica.',
  '- faq_clinic: FAQ institucional da clínica (estacionamento, pet, o que levar, pagamento no dia, visita) — não é preço, não é explicação de zona/serviço.',
  '- informacao: pergunta aberta fora do cadálogo fechado (opinião, saúde, comparação subjectiva, ou nada que o cadastro responda).',
  '- outro: agradecimento, conversa, ou nada disto.',
  'Perguntar sobre a política de cancelar ou remarcar («tem multa?», «cobram?») é faq_catalog, não cancelar nem remarcar.',
  '«O que inclui a íntima?», «como é a depilação?», «inclui ânus?», «Fazem depilação íntima?» são faq_catalog, não faq_clinic nem informacao.',
  // Oferta nomeada: alinhado a TRE-112 / #1020 (cue léxico + mesma etiqueta no classificador).
  '«Vocês têm limpeza de pele?» (serviço/zona nomeados, sem pedir vaga) é faq_catalog.',
  '«Tem estacionamento?», «posso levar o pet?», «o que eu levo?», «aceitam cartão no dia?» são faq_clinic.',
  '«Me mostra a agenda», «quero ver a grade de horários» são agendar (ver agenda para marcar), não informacao.',
  'Na dúvida entre agendar e price/faq_catalog/faq_clinic, prefira agendar se houver pedido de vaga ou marcar.',
  'Na dúvida entre team e outra classe, só use team se o pedido de pessoa for o acto principal.',
].join('\n')

export const CLASSIFY_TOOL = {
  name: CLASSIFY_TOOL_NAME,
  description: 'Regista a classe da mensagem e a confiança.',
  input_schema: {
    type: 'object',
    properties: {
      classe: { type: 'string', enum: [...INTENT_CLASSES] },
      confianca: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['classe', 'confianca'],
    additionalProperties: false,
  },
}

export type LlmClassification = { label: IntentLabel; confidence: number; raw: LlmIntentClass }

function labelFromRaw(raw: LlmIntentClass): IntentLabel {
  if (raw === 'informacao' || raw === 'outro') return 'nenhum'
  return raw
}

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
  if (typeof raw !== 'string' || !(INTENT_CLASSES as readonly string[]).includes(raw)) return null
  if (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1) return null
  const typed = raw as LlmIntentClass
  return { label: labelFromRaw(typed), confidence: conf, raw: typed }
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

/**
 * Confiança mínima por defeito para desviar um turno do redator para o handler.
 * D2 (**Proposto**): limiar único 0,7 até amostra real + confirmação do Paulo;
 * `minConfidenceFor` permite afinar por etiqueta sem mudar o gate.
 */
export const INTENT_MIN_CONFIDENCE = 0.7

/** Overrides por etiqueta (vazio até medição D2). */
const INTENT_MIN_CONFIDENCE_BY_LABEL: Partial<Record<IntentLabel, number>> = {}

/** Limiar por etiqueta (hoje = defeito para todas; overrides só após medição D2). */
export function minConfidenceFor(label: IntentLabel): number {
  return INTENT_MIN_CONFIDENCE_BY_LABEL[label] ?? INTENT_MIN_CONFIDENCE
}

function hasMinConfidence(
  c: { label: IntentLabel; confidence: number } | null | undefined,
): boolean {
  return Boolean(c && c.confidence >= minConfidenceFor(c.label))
}

/** Etiqueta fechada com confiança suficiente → o redator fica de fora neste turno. */
export function isClosedIntent(
  c: { label: IntentLabel; confidence: number } | null | undefined,
): c is { label: ClosedIntentLabel; confidence: number } {
  if (!hasMinConfidence(c) || !c) return false
  return (CLOSED_INTENT_LABELS as readonly string[]).includes(c.label)
}

/** Classes que levam ao link «Abrir agenda»; price/team/faq_* usam outros handlers. */
export function intentLinkPurpose(
  c: { label: IntentLabel; confidence: number } | null | undefined,
): 'agendar' | 'remarcar' | 'cancelar' | null {
  if (!isClosedIntent(c)) return null
  if (c.label === 'agendar' || c.label === 'misto') return 'agendar'
  if (c.label === 'remarcar' || c.label === 'cancelar') return c.label
  return null
}

/** Handler fechado que não é link de agenda (price / team / faq_catalog / faq_clinic). */
export function closedCatalogOrTeamLabel(
  c: { label: IntentLabel; confidence: number } | null | undefined,
): 'price' | 'team' | 'faq_catalog' | 'faq_clinic' | null {
  if (!isClosedIntent(c)) return null
  if (
    c.label === 'price' ||
    c.label === 'team' ||
    c.label === 'faq_catalog' ||
    c.label === 'faq_clinic'
  ) {
    return c.label
  }
  return null
}

function envFlagOn(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on'
}

/** Interruptor por ambiente (`INTENT_LLM_ENABLED=1|true|on`). Ausente ou outro valor = desligado. */
export function isIntentLlmEnabled(env: { INTENT_LLM_ENABLED?: string }): boolean {
  return envFlagOn(env.INTENT_LLM_ENABLED)
}

/**
 * Sombra do classificador (`INTENT_LLM_SHADOW=1|true|on`): corre a etiqueta e regista
 * `ai.intent_llm` com `mode=shadow`, **sem** desviar o redator. Útil em produção antes de D5
 * (checklist `docs/implementation/intent-llm-producao.md`). Se `INTENT_LLM_ENABLED` também
 * estiver ligado, o caminho vivo prevalece (shadow não sobrescreve).
 */
export function isIntentLlmShadowEnabled(env: { INTENT_LLM_SHADOW?: string }): boolean {
  return envFlagOn(env.INTENT_LLM_SHADOW)
}

/** Classificar neste turno: live e/ou sombra. */
export function shouldClassifyIntent(env: {
  INTENT_LLM_ENABLED?: string
  INTENT_LLM_SHADOW?: string
}): boolean {
  return isIntentLlmEnabled(env) || isIntentLlmShadowEnabled(env)
}

/**
 * Só sombra (medir sem desviar): shadow on e live off.
 * Com live on, o handler fechado desvia como hoje.
 */
export function isIntentLlmShadowOnly(env: {
  INTENT_LLM_ENABLED?: string
  INTENT_LLM_SHADOW?: string
}): boolean {
  return isIntentLlmShadowEnabled(env) && !isIntentLlmEnabled(env)
}
