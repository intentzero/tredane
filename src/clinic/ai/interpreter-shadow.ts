/**
 * Sombra do interpretador LLM (Proposto; análise de 13/11/2026).
 *
 * Mede, sem alterar o atendimento, o que o extrator leria em **todo** turno de
 * texto livre — e não só quando o léxico não acha nenhum campo. Compara com o
 * interpretador determinístico e regista a divergência por campo.
 *
 * - Não grava o quadro, não envia mensagem, não conta no teto diário da clínica.
 * - Contexto igual ao da DEC-109 (turno, pergunta pendente, nomes do catálogo).
 * - O log não leva texto da conversa, nomes, ids de catálogo nem trechos literais.
 * - Desligado por omissão: `AI_INTERPRETER_SHADOW=on` no ambiente.
 */
import type { ServiceRow } from '../config/types'
import {
  callExtractorModel,
  validateExtractorOutput,
  type ExtractorRaw,
} from './llm-extractor'
import { interpretTurn, type TurnInterpretation } from './nlu/interpret'
import { norm, parseTemporal, parseTimes } from './nlu/temporal'
import type { BookingFramePending } from './schedule-session'
import type { AiAssistDeps } from './types'

/** Teto próprio: a sombra corre depois das respostas e não deve prender o alarme. */
export const AI_INTERPRETER_SHADOW_TIMEOUT_MS = 8_000

export function interpreterShadowEnabled(raw: string | undefined | null): boolean {
  const v = (raw ?? '').trim().toLowerCase()
  return v === 'on' || v === '1' || v === 'true'
}

export const SHADOW_FIELDS = [
  'service',
  'variants',
  'line',
  'professional',
  'date',
  'period',
  'time',
  'option',
] as const
export type ShadowField = (typeof SHADOW_FIELDS)[number]

/**
 * `agree` os dois leram o mesmo · `differ` leram valores diferentes ·
 * `llm_only` só o modelo leu · `rule_only` só o léxico leu · `none` ninguém leu.
 */
export type ShadowVerdict = 'agree' | 'differ' | 'llm_only' | 'rule_only' | 'none'

/** Leitura do modelo aceite só por existir no catálogo / resolver no parser. */
export type ShadowSlots = {
  service?: string
  variants?: string[]
  line?: 'feminino' | 'masculino'
  professional?: string
  date?: string
  period?: 'manha' | 'tarde' | 'noite'
  time?: string
  option?: number
}

/**
 * Validação **relaxada**: o id tem de existir e estar activo no catálogo; data e
 * hora têm de resolver no parser determinístico. Não exige citação literal do
 * nome na frase — é essa a diferença para `validateExtractorOutput`.
 */
export function resolveShadowSlots(
  raw: ExtractorRaw,
  opts: {
    today: string
    services: ServiceRow[]
    professionals: Array<{ id: string; name: string }>
    pending: BookingFramePending | null
  },
): { slots: ShadowSlots; rejected: string[] } {
  const slots: ShadowSlots = {}
  const rejected: string[] = []
  const active = opts.services.filter((s) => s.active)

  const variantService = new Map<string, string>()
  for (const s of active) {
    for (const z of s.zones) if (z.active) variantService.set(z.id, s.id)
  }

  if (Array.isArray(raw.variantIds) && raw.variantIds.length > 0) {
    const owners = new Set(raw.variantIds.map((id) => variantService.get(id)))
    if (owners.has(undefined) || owners.size !== 1) rejected.push('variants')
    else slots.variants = [...new Set(raw.variantIds)].sort()
  }

  if (raw.serviceId) {
    const exists = active.some((s) => s.id === raw.serviceId)
    const owner = slots.variants ? variantService.get(slots.variants[0]!) : null
    if (!exists || (owner && owner !== raw.serviceId)) rejected.push('service')
    else slots.service = raw.serviceId
  } else if (slots.variants) {
    slots.service = variantService.get(slots.variants[0]!)
  }

  if (raw.line === 'feminino' || raw.line === 'masculino') slots.line = raw.line
  else if (raw.line != null) rejected.push('line')

  if (raw.professionalId) {
    if (opts.professionals.some((p) => p.id === raw.professionalId)) {
      slots.professional = raw.professionalId
    } else rejected.push('professional')
  }

  if (typeof raw.dateLiteral === 'string' && raw.dateLiteral.trim()) {
    const parsed = parseTemporal(raw.dateLiteral.trim().slice(0, 80), opts.today)
    if (parsed.dates.length === 1 && !parsed.dateConflict && !parsed.invalidDateMention) {
      slots.date = parsed.dates[0]!
    } else rejected.push('date')
  }

  if (raw.period === 'manha' || raw.period === 'tarde' || raw.period === 'noite') {
    slots.period = raw.period
  } else if (raw.period != null) rejected.push('period')

  if (typeof raw.timeLiteral === 'string' && raw.timeLiteral.trim()) {
    const parsed = parseTimes(norm(raw.timeLiteral.trim().slice(0, 40)))
    if (parsed.times.length === 1) slots.time = parsed.times[0]!
    else rejected.push('time')
  }

  if (typeof raw.optionIndex === 'number') {
    const n = opts.pending?.options.length ?? 0
    if (Number.isInteger(raw.optionIndex) && raw.optionIndex >= 0 && raw.optionIndex < n) {
      slots.option = raw.optionIndex
    } else rejected.push('option')
  }

  return { slots, rejected }
}

function ruleSlots(base: TurnInterpretation): ShadowSlots {
  const s = base.slots
  return {
    ...(s.serviceId ? { service: s.serviceId.value } : {}),
    ...(s.variantIds ? { variants: [...new Set(s.variantIds.value)].sort() } : {}),
    ...(s.line ? { line: s.line.value } : {}),
    ...(s.professionalId ? { professional: s.professionalId.value } : {}),
    ...(s.date ? { date: s.date.value } : {}),
    ...(s.period ? { period: s.period.value } : {}),
    ...(s.time ? { time: s.time.value } : {}),
    ...(s.optionIndex ? { option: s.optionIndex.value } : {}),
  }
}

function verdict(rule: unknown, llm: unknown): ShadowVerdict {
  const hasRule = rule !== undefined
  const hasLlm = llm !== undefined
  if (!hasRule && !hasLlm) return 'none'
  if (hasRule && !hasLlm) return 'rule_only'
  if (!hasRule && hasLlm) return 'llm_only'
  return JSON.stringify(rule) === JSON.stringify(llm) ? 'agree' : 'differ'
}

export type ShadowComparison = {
  fields: Record<ShadowField, ShadowVerdict>
  /** Há pelo menos um campo `differ`, `llm_only` ou `rule_only`. */
  diverged: boolean
  /** Campos que só o modelo leu (o ganho potencial de inverter a compreensão). */
  llmOnly: ShadowField[]
  /** Campos em que as duas leituras se contradizem (risco a rever por pessoa). */
  differ: ShadowField[]
  variantCount: { rule: number; llm: number }
}

export function compareInterpretations(base: TurnInterpretation, llm: ShadowSlots): ShadowComparison {
  const rule = ruleSlots(base)
  const fields = {} as Record<ShadowField, ShadowVerdict>
  for (const f of SHADOW_FIELDS) fields[f] = verdict(rule[f], llm[f])
  const llmOnly = SHADOW_FIELDS.filter((f) => fields[f] === 'llm_only')
  const differ = SHADOW_FIELDS.filter((f) => fields[f] === 'differ')
  return {
    fields,
    diverged: SHADOW_FIELDS.some((f) => fields[f] !== 'agree' && fields[f] !== 'none'),
    llmOnly,
    differ,
    variantCount: { rule: rule.variants?.length ?? 0, llm: llm.variants?.length ?? 0 },
  }
}

/** Fotografia do turno tirada **antes** de o motor mexer no quadro. */
export type InterpreterShadowTask = {
  tenantId: string
  conversationId: string
  messageId: string
  turnText: string
  today: string
  services: ServiceRow[]
  professionals: Array<{ id: string; name: string }>
  pending: BookingFramePending | null
  /** Saída do extrator do caminho real, se ele já chamou o modelo neste turno. */
  mainRaw?: ExtractorRaw | null
  mainModelCalled: boolean
}

export type InterpreterShadowEvent = {
  level: 'info'
  event: 'ai.interpreter_shadow'
  tenantId: string
  conversationId: string
  messageId: string
  /** `ok` comparou · `provider` / `parse` a chamada falhou (sem comparação). */
  status: 'ok' | 'provider' | 'parse'
  /** O caminho real chamou o extrator neste turno (cobertura baixa). */
  mainModelCalled: boolean
  /** A sombra reutilizou essa saída em vez de chamar outra vez. */
  reusedMainCall: boolean
  pendingSlot: string | null
  ruleCoverage: number
  ruleActs: string[]
  llmActs: string[]
  fields?: Record<ShadowField, ShadowVerdict>
  diverged?: boolean
  llmOnly?: ShadowField[]
  differ?: ShadowField[]
  variantCount?: { rule: number; llm: number }
  /** O que o validador de hoje (citação literal) recusaria desta saída. */
  strictDiscarded?: string[]
  /** O que nem a validação relaxada aceita (id fora do catálogo, data sem resolução). */
  relaxedRejected?: string[]
  model: string | null
  latencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
}

/**
 * Corre a sombra de um turno e devolve o evento (também escrito em `console.info`).
 * Nunca lança: qualquer erro vira `status: 'provider'`.
 */
export async function runInterpreterShadow(
  deps: AiAssistDeps,
  task: InterpreterShadowTask,
): Promise<InterpreterShadowEvent> {
  const base = interpretTurn({
    turnText: task.turnText,
    messageId: task.messageId,
    today: task.today,
    services: task.services,
    pending: task.pending,
    professionals: task.professionals,
  })
  const event: InterpreterShadowEvent = {
    level: 'info',
    event: 'ai.interpreter_shadow',
    tenantId: task.tenantId,
    conversationId: task.conversationId,
    messageId: task.messageId,
    status: 'ok',
    mainModelCalled: task.mainModelCalled,
    reusedMainCall: false,
    pendingSlot: task.pending?.slot ?? null,
    ruleCoverage: Math.round(base.coverage * 100) / 100,
    ruleActs: base.acts,
    llmActs: [],
    model: null,
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
  }

  let raw: ExtractorRaw | null = task.mainRaw ?? null
  if (raw) {
    event.reusedMainCall = true
  } else {
    try {
      const called = await callExtractorModel(deps, {
        turnText: task.turnText,
        pending: task.pending,
        services: task.services,
        professionals: task.professionals,
        timeoutMs: AI_INTERPRETER_SHADOW_TIMEOUT_MS,
      })
      event.model = called.gen.model
      event.latencyMs = called.gen.latencyMs
      if (!called.gen.ok) {
        event.status = 'provider'
      } else {
        event.inputTokens = called.gen.inputTokens
        event.outputTokens = called.gen.outputTokens
        raw = called.raw
        if (!raw) event.status = 'parse'
      }
    } catch {
      event.status = 'provider'
    }
  }

  if (raw) {
    const relaxed = resolveShadowSlots(raw, task)
    const strict = validateExtractorOutput(raw, {
      messageId: task.messageId,
      turnText: task.turnText,
      today: task.today,
      services: task.services,
      professionals: task.professionals,
      pending: task.pending,
      base,
    })
    const cmp = compareInterpretations(base, relaxed.slots)
    event.llmActs = (raw.acts ?? []).filter((a): a is string => typeof a === 'string').slice(0, 8)
    event.fields = cmp.fields
    event.diverged = cmp.diverged
    event.llmOnly = cmp.llmOnly
    event.differ = cmp.differ
    event.variantCount = cmp.variantCount
    // `act:<valor>` traz texto do modelo; fica só a categoria.
    event.strictDiscarded = [...new Set(strict.discarded.map((d) => d.split(':')[0]!))]
    event.relaxedRejected = relaxed.rejected
  }

  console.info(JSON.stringify(event))
  return event
}
