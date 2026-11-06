/**
 * Extrator LLM restrito (#416 / DEC-109 / núcleo §3.2 · 2b).
 * Tool use com enums = ids do grafo; backend valida; confiança nunca autoriza.
 */
import {
  AI_MODEL_EXTRACT,
  AI_TIMEOUT_MS,
  EXTRACTOR_STABLE_SYSTEM,
  EXTRACT_TOOL_NAME,
  buildExtractTool,
  buildExtractorUserContent,
  type AiContextPayload,
} from '../../ai'
import type { AiAssistDeps } from './types'
import type { Clock } from '../../db/clock'
import type { ServiceRow } from '../config/types'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import type { ClinicDb } from '../store'
import { ensureClinicSettings } from '../config/settings'
import {
  interpretTurn,
  COVERAGE_THRESHOLD,
  type TurnInterpretation,
  type TurnSlots,
  type Field,
  type TurnAct,
} from './nlu/interpret'
import { norm, parseTemporal, parseTimes } from './nlu/temporal'
import { textCitesNameOrSynonym } from '../config/synonyms'
import {
  getBookingFrame,
  saveBookingFrame,
  type BookingFramePending,
  type BookingFramePatch,
  type ScheduleAudienceLine,
  type SchedulePeriod,
} from './schedule-session'
import type { TurnContext } from './turn-context'

export { COVERAGE_THRESHOLD }

export type ExtractorRaw = {
  acts?: string[]
  serviceId?: string
  line?: string
  variantIds?: string[]
  professionalId?: string
  dateLiteral?: string
  period?: string
  timeLiteral?: string
  optionIndex?: number
  confidence?: number
}

export type ValidatedExtraction = {
  interpretation: TurnInterpretation
  /** Slots aceites após validação (fonte llm). Confiança ignorada. */
  applied: boolean
  discarded: string[]
  modelCalled: boolean
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
}

function fieldLlm<T>(value: T, messageId: string, trecho: string): Field<T> {
  return { value, messageId, trecho, fonte: 'llm' }
}

function emptyContext(): AiContextPayload {
  return {
    contactFirstName: null,
    stage: null,
    services: [],
    messages: [],
    hasClinicOutbound: false,
    clinicOutboundCount: 0,
  }
}

export function catalogNamesFromServices(
  services: ServiceRow[],
  professionals: Array<{ id: string; name: string }>,
): {
  services: Array<{ id: string; name: string }>
  variants: Array<{ id: string; name: string; serviceId: string }>
  professionals: Array<{ id: string; name: string }>
} {
  const variants: Array<{ id: string; name: string; serviceId: string }> = []
  for (const s of services) {
    for (const z of s.zones.filter((z) => z.active)) {
      variants.push({ id: z.id, name: z.name, serviceId: s.id })
    }
  }
  return {
    services: services.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name })),
    variants,
    professionals,
  }
}

/**
 * Valida a saída do modelo contra o catálogo e o parser temporal.
 * Qualquer campo fora do enum / trecho sem resolução é descartado.
 */
export function validateExtractorOutput(
  raw: ExtractorRaw,
  opts: {
    messageId: string
    /** Frase da cliente. Catálogo ou trecho com o nome do catálogo não bastam. */
    turnText: string
    today: string
    services: ServiceRow[]
    professionals: Array<{ id: string; name: string }>
    pending: BookingFramePending | null
    base: TurnInterpretation
  },
): { slots: TurnSlots; acts: TurnAct[]; discarded: string[] } {
  const discarded: string[] = []
  const slots: TurnSlots = { ...opts.base.slots }
  const variantById = new Map<string, { serviceId: string; name: string; synonyms: string[] }>()
  for (const s of opts.services) {
    for (const z of s.zones) {
      variantById.set(z.id, { serviceId: s.id, name: z.name, synonyms: z.synonyms ?? [] })
    }
  }
  const cites = (name: string, synonyms?: readonly string[] | null) =>
    textCitesNameOrSynonym(opts.turnText, name, synonyms)
  const clientTimes = new Set(parseTimes(norm(opts.turnText)).times)
  const clientDates = parseTemporal(opts.turnText, opts.today)
  const folded = norm(opts.turnText)

  // Confiança nunca autoriza — só telemetria local descartada.
  void raw.confidence

  const acts: TurnAct[] = []
  const allowedActs = new Set<string>([
    'marcar',
    'informar_preco',
    'informar_horario_funcionamento',
    'informar_local',
    'explicar',
    'escolher_opcao',
    'afirmar',
    'negar',
    'corrigir',
    'adiar',
    'pedir_pessoa',
    'remarcar',
    'cancelar',
    'cumprimento',
    'desconhecido',
  ])
  for (const a of raw.acts ?? []) {
    if (allowedActs.has(a)) acts.push(a as TurnAct)
    else discarded.push(`act:${a}`)
  }

  let variantServiceId: string | null = null
  if (Array.isArray(raw.variantIds) && raw.variantIds.length > 0) {
    const requested = raw.variantIds.filter((id) => id !== '_none')
    const ok = requested.filter((id) => {
      const meta = variantById.get(id)
      return Boolean(meta && cites(meta.name, meta.synonyms))
    })
    if (requested.length === 0 || ok.length !== requested.length) discarded.push('variantIds')
    else {
      const names = ok.map((id) => variantById.get(id)!.name).join(', ')
      slots.variantIds = fieldLlm(ok, opts.messageId, names)
      variantServiceId = variantById.get(ok[0]!)!.serviceId
    }
  }

  if (raw.serviceId) {
    const svc = opts.services.find((s) => s.id === raw.serviceId)
    const viaZone = Boolean(svc && variantServiceId === svc.id)
    if (svc && raw.serviceId !== '_none' && (cites(svc.name, svc.synonyms) || viaZone)) {
      slots.serviceId = fieldLlm(raw.serviceId, opts.messageId, svc.name)
    } else discarded.push('serviceId')
  } else if (variantServiceId && !slots.serviceId) {
    const name = opts.services.find((s) => s.id === variantServiceId)?.name ?? variantServiceId
    slots.serviceId = fieldLlm(variantServiceId, opts.messageId, name)
  }

  if (raw.line === 'feminino' || raw.line === 'masculino') {
    const word = raw.line === 'feminino' ? /\bfemin(?:ina|ino)\b/ : /\bmasculin(?:a|o)\b/
    if (word.test(folded)) slots.line = fieldLlm(raw.line, opts.messageId, raw.line)
    else discarded.push('line')
  } else if (raw.line != null) {
    discarded.push('line')
  }

  if (raw.professionalId) {
    const pro = opts.professionals.find((p) => p.id === raw.professionalId)
    if (pro && raw.professionalId !== '_none' && cites(pro.name, [])) {
      slots.professionalId = fieldLlm(raw.professionalId, opts.messageId, pro.name)
    } else discarded.push('professionalId')
  }

  if (typeof raw.dateLiteral === 'string' && raw.dateLiteral.trim()) {
    const lit = raw.dateLiteral.trim().slice(0, 80)
    const parsed = parseTemporal(lit, opts.today)
    const supported =
      parsed.dates.length === 1 &&
      !parsed.dateConflict &&
      !parsed.invalidDateMention &&
      !clientDates.dateConflict &&
      !clientDates.invalidDateMention &&
      clientDates.dates.includes(parsed.dates[0]!)
    if (supported) {
      slots.date = fieldLlm(parsed.dates[0]!, opts.messageId, lit)
    } else {
      slots.dateLiteral = fieldLlm(lit, opts.messageId, lit)
      discarded.push('dateUnresolved')
    }
  }

  if (raw.period === 'manha' || raw.period === 'tarde' || raw.period === 'noite') {
    if (new RegExp(`\\b${raw.period}\\b`).test(folded)) {
      slots.period = fieldLlm(raw.period, opts.messageId, raw.period)
    } else discarded.push('period')
  } else if (raw.period != null) {
    discarded.push('period')
  }

  if (typeof raw.timeLiteral === 'string' && raw.timeLiteral.trim()) {
    const lit = raw.timeLiteral.trim().slice(0, 40)
    const parsed = parseTimes(norm(lit))
    if (parsed.times.length === 1 && clientTimes.has(parsed.times[0]!)) {
      slots.time = fieldLlm(parsed.times[0]!, opts.messageId, lit)
    } else {
      discarded.push('timeUnresolved')
    }
  }

  if (typeof raw.optionIndex === 'number') {
    const pending = opts.pending
    const inRange =
      pending &&
      Number.isInteger(raw.optionIndex) &&
      raw.optionIndex >= 0 &&
      raw.optionIndex < pending.options.length
    const opt = inRange ? pending.options[raw.optionIndex]! : null
    const optTimes = opt ? parseTimes(norm(`${opt.label} ${opt.key}`)).times : []
    const evidenced = Boolean(
      opt && (optTimes.some((time) => clientTimes.has(time)) || cites(opt.label, [])),
    )
    if (opt && evidenced) {
      slots.optionIndex = fieldLlm(raw.optionIndex, opts.messageId, opt.label)
    } else {
      discarded.push('optionIndex')
    }
  }

  return {
    slots,
    acts: acts.length > 0 ? acts : opts.base.acts,
    discarded,
  }
}

function parseRaw(text: string): ExtractorRaw | null {
  try {
    const v = JSON.parse(text) as ExtractorRaw
    if (!v || typeof v !== 'object') return null
    return v
  } catch {
    return null
  }
}

/**
 * Corre o interpretador; se cobertura baixa, chama o extrator e aplica slots válidos ao frame.
 */
export async function runRestrictedExtractor(
  db: ClinicDb,
  tenantId: string,
  turn: TurnContext,
  clock: Clock,
  deps: AiAssistDeps,
): Promise<ValidatedExtraction> {
  const settings = turn.settings ?? ensureClinicSettings(db, tenantId, clock)
  const today = clinicCivilDateFromUtc(settings.timezone || 'America/Sao_Paulo', clock.nowMs())
  const frame = getBookingFrame(db, tenantId, turn.conversationId)
  const professionals = [...turn.catalog.professionalsByService.values()].flat()
  const uniquePros = new Map(professionals.map((p) => [p.id, p]))
  const proList = [...uniquePros.values()]

  const base = interpretTurn({
    turnText: turn.turnText,
    messageId: turn.messageId,
    today,
    services: turn.catalog.services,
    pending: frame?.pending ?? null,
    professionals: proList,
  })

  if (!base.needsExtractor) {
    return {
      interpretation: base,
      applied: false,
      discarded: [],
      modelCalled: false,
      model: null,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null,
    }
  }

  const catalog = catalogNamesFromServices(turn.catalog.services, proList)
  const tool = buildExtractTool(catalog)
  const userContent = buildExtractorUserContent({
    turnText: turn.turnText,
    pending: frame?.pending
      ? { slot: frame.pending.slot, options: frame.pending.options }
      : null,
    catalog,
  })

  const gen = await deps.adapter.generate({
    kind: 'reply',
    profile: 'extract',
    context: emptyContext(),
    warnings: [],
    servicesWithoutPrice: [],
    servicesWithoutExplanation: [],
    explanationSources: [],
    maxOutputTokens: 512,
    timeoutMs: AI_TIMEOUT_MS,
    model: AI_MODEL_EXTRACT,
    systemPromptOverride: EXTRACTOR_STABLE_SYSTEM,
    userContentOverride: userContent,
    tools: [tool],
    toolChoice: { type: 'tool', name: EXTRACT_TOOL_NAME },
    promptCache: true,
  })

  if (!gen.ok) {
    return {
      interpretation: base,
      applied: false,
      discarded: ['provider'],
      modelCalled: true,
      model: gen.model,
      inputTokens: null,
      outputTokens: null,
      latencyMs: gen.latencyMs,
    }
  }

  const raw = parseRaw(gen.text)
  if (!raw) {
    return {
      interpretation: base,
      applied: false,
      discarded: ['parse'],
      modelCalled: true,
      model: gen.model,
      inputTokens: gen.inputTokens,
      outputTokens: gen.outputTokens,
      latencyMs: gen.latencyMs,
    }
  }

  const validated = validateExtractorOutput(raw, {
    messageId: turn.messageId,
    turnText: turn.turnText,
    today,
    services: turn.catalog.services,
    professionals: proList,
    pending: frame?.pending ?? null,
    base,
  })

  const coverage = Math.max(base.coverage, validated.discarded.includes('parse') ? 0 : 0.7)
  const interpretation: TurnInterpretation = {
    acts: validated.acts,
    slots: validated.slots,
    coverage,
    needsExtractor: coverage < COVERAGE_THRESHOLD || validated.acts.includes('desconhecido'),
  }

  // Só preenche campos vazios do frame (confiança nunca autoriza nem sobrescreve).
  let applied = false
  const s = validated.slots
  const serviceId = frame?.serviceId ?? turn.session?.serviceId ?? s.serviceId?.value ?? null
  if (!serviceId) {
    // Sem serviço no frame nem no extrato válido — não grava.
  } else {
    const patch: BookingFramePatch = {
      serviceId,
      sourceMessageId: turn.messageId,
      source: 'llm',
      catalogVersion: turn.catalog.version,
    }
    let dirty = false
    if (!frame?.serviceId && s.serviceId) dirty = true
    if (!frame?.line && s.line) {
      patch.line = s.line.value as ScheduleAudienceLine
      dirty = true
    }
    if ((!frame?.variantIds || frame.variantIds.length === 0) && s.variantIds) {
      patch.variantIds = s.variantIds.value
      dirty = true
    }
    if (!frame?.date && s.date) {
      patch.date = s.date.value
      dirty = true
    }
    if (!frame?.period && s.period) {
      patch.period = s.period.value as SchedulePeriod
      dirty = true
    }
    if (!frame?.time && s.time) {
      patch.time = s.time.value
      dirty = true
    }
    if (!frame?.professionalPref && s.professionalId) {
      patch.professionalPref = s.professionalId.value
      dirty = true
    }
    if (dirty) {
      if (frame?.phase === 'idle' || !frame) patch.phase = 'coletando'
      saveBookingFrame(db, tenantId, turn.conversationId, patch, clock)
      applied = true
    }
  }

  return {
    interpretation,
    applied,
    discarded: validated.discarded,
    modelCalled: true,
    model: gen.model,
    inputTokens: gen.inputTokens,
    outputTokens: gen.outputTokens,
    latencyMs: gen.latencyMs,
  }
}
