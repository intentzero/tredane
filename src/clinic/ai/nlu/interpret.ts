/**
 * Interpretador determinístico do turno (#416 / núcleo §3.2).
 * Produz atos, slots com proveniência e cobertura; o LLM extrator só entra
 * quando a cobertura fica abaixo do limiar ou o ato é `desconhecido`.
 */
import type { ServiceRow } from '../../config/types'
import { zonesNamedInText } from '../../config/zones'
import type { BookingFramePending } from '../schedule-session'
import { citesServiceName } from '../schedule-choice'
import { classifySensitive } from './sensitive'
import { extractDates, extractTimes, parseTemporal, norm } from './temporal'

export const COVERAGE_THRESHOLD = 0.55

export type TurnAct =
  | 'marcar'
  | 'informar_preco'
  | 'informar_horario_funcionamento'
  | 'informar_local'
  | 'explicar'
  | 'escolher_opcao'
  | 'afirmar'
  | 'negar'
  | 'corrigir'
  | 'adiar'
  | 'pedir_pessoa'
  | 'remarcar'
  | 'cancelar'
  | 'saude'
  | 'terceiro'
  | 'ofensa'
  | 'injecao'
  | 'cumprimento'
  | 'desconhecido'

export type FieldSource = 'regra' | 'botao' | 'llm'

export type Field<T> = {
  value: T
  messageId: string
  trecho: string
  fonte: FieldSource
}

export type TurnSlots = {
  serviceId?: Field<string>
  line?: Field<'feminino' | 'masculino'>
  variantIds?: Field<string[]>
  professionalId?: Field<string>
  /** Data civil YYYY-MM-DD quando o parser resolve; senão fica no extrator. */
  date?: Field<string>
  /** Trecho literal de data para o parser (#408), se ainda não resolvido. */
  dateLiteral?: Field<string>
  period?: Field<'manha' | 'tarde' | 'noite'>
  time?: Field<string>
  optionIndex?: Field<number>
}

export type TurnInterpretation = {
  acts: TurnAct[]
  slots: TurnSlots
  /** Fração de tokens do turno explicados por regras (0–1). */
  coverage: number
  /** true quando coverage < limiar ou ato desconhecido. */
  needsExtractor: boolean
}

const PRICE = /\b(pre[cç]o|custa|valor|quanto)\b/i
const HOURS = /\b(hor[aá]rio de funcionamento|que horas|abrem|funcionam|atendem)\b/i
const LOCAL = /\b(onde fica|endere[cç]o|localiza[cç][aã]o|como chegar|maps?|google)\b/i
const EXPLAIN = /\b(como funciona|o que [eé]|explica|procedimento)\b/i
const GREET = /^(oi|ol[aá]|bom dia|boa tarde|boa noite|oie|opa)[\s!.?]*$/i
const AFFIRM = /^(sim|pode ser|pode|ok|okay|beleza|blz|👍|bora|fechado|combinado)[\s!.?]*$/i
const DENY = /^(n[aã]o|nao quero|melhor n[aã]o)[\s!.?]*$/i
const DEFER = /\b(vou pensar|vou ver|depois|mais tarde|talvez)\b/i
const CORRECT = /\b(na verdade|quero dizer|prefiro|troca|muda|n[aã]o[, ]+)\b/i
const BOOK =
  /\b(quero|gostaria|marcar|agendar|hor[aá]rio|disponi|vaga|fazer|preciso)\b/i
const RESCHEDULE = /\b(reagend\w*|remarc\w*)\b/i
const CANCEL = /\b(desmarc\w*|cancel\w*)\b/i
const ORDINAL =
  /\b(primeira|segundo|segunda|terceir[ao]|quart[ao]|quint[ao]|a\s+1([aª.]|\s)|a\s+2([aª.]|\s)|a\s+3([aª.]|\s)|op[cç][aã]o\s+\d)\b/i

function tokenize(text: string): string[] {
  return norm(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
}

function field<T>(value: T, messageId: string, trecho: string, fonte: FieldSource = 'regra'): Field<T> {
  return { value, messageId, trecho, fonte }
}

function matchPendingOption(
  text: string,
  pending: BookingFramePending | null,
): { index: number; key: string; label: string } | null {
  if (!pending || pending.options.length === 0) return null
  const folded = norm(text)
  if (pending.options.length === 1 && AFFIRM.test(text.trim())) {
    const only = pending.options[0]!
    return { index: 0, key: only.key, label: only.label }
  }
  for (let i = 0; i < pending.options.length; i++) {
    const opt = pending.options[i]!
    const label = norm(opt.label)
    const key = norm(opt.key)
    // Cliente cita o rótulo ou a chave («14:00», «o das 14», «14h»).
    if (label.length >= 2 && (folded.includes(label) || label.includes(folded))) {
      return { index: i, key: opt.key, label: opt.label }
    }
    if (key.length >= 2 && (folded.includes(key) || key.includes(folded))) {
      return { index: i, key: opt.key, label: opt.label }
    }
    const hhmm = key.match(/^(\d{1,2}):(\d{2})$/)
    if (hhmm) {
      const h = Number(hhmm[1])
      const m = hhmm[2]
      const hourRe = new RegExp(
        `\\b(das?\\s+)?${h}(h(:?${m})?|:${m})?\\b`,
      )
      if (hourRe.test(folded)) return { index: i, key: opt.key, label: opt.label }
    }
  }
  const ord = folded.match(/\b(primeira|1[aª.]?|opcao\s*1)\b/)
    ? 0
    : folded.match(/\b(segunda|2[aª.]?|opcao\s*2)\b/)
      ? 1
      : folded.match(/\b(terceira|3[aª.]?|opcao\s*3)\b/)
        ? 2
        : folded.match(/\b(quarta|4[aª.]?|opcao\s*4)\b/)
          ? 3
          : folded.match(/\b(quinta|5[aª.]?|opcao\s*5)\b/)
            ? 4
            : -1
  if (ord >= 0 && ord < pending.options.length) {
    const opt = pending.options[ord]!
    return { index: ord, key: opt.key, label: opt.label }
  }
  return null
}

export type InterpretInput = {
  turnText: string
  messageId: string
  today: string
  services: ServiceRow[]
  pending?: BookingFramePending | null
  /** Nomes de profissionais activos (id + name). */
  professionals?: Array<{ id: string; name: string }>
}

/**
 * Interpretação determinística. Confiança do modelo não entra aqui.
 */
export function interpretTurn(input: InterpretInput): TurnInterpretation {
  const text = input.turnText.trim()
  const messageId = input.messageId
  const acts: TurnAct[] = []
  const slots: TurnSlots = {}
  const tokens = tokenize(text)
  const explained = new Set<string>()

  const markTokens = (re: RegExp | string) => {
    if (typeof re === 'string') {
      for (const w of tokenize(re)) {
        if (tokens.includes(w)) explained.add(w)
      }
      return
    }
    const m = text.match(re)
    if (m?.[0]) markTokens(m[0])
  }

  const sensitive = classifySensitive(text)
  for (const hit of sensitive) {
    if (hit.label === 'saude') acts.push('saude')
    else if (hit.label === 'ofensa') acts.push('ofensa')
    else if (hit.label === 'terceiro') acts.push('terceiro')
    else if (hit.label === 'pedir_pessoa' || hit.label === 'pedir_parar') acts.push('pedir_pessoa')
    else if (hit.label === 'injecao') acts.push('injecao')
    else if (hit.label === 'cancelar') acts.push('cancelar')
    else if (hit.label === 'remarcar') acts.push('remarcar')
    markTokens(text)
  }

  if (CANCEL.test(text)) {
    acts.push('cancelar')
    markTokens(CANCEL)
  }
  if (RESCHEDULE.test(text)) {
    acts.push('remarcar')
    markTokens(RESCHEDULE)
  }
  if (PRICE.test(text)) {
    acts.push('informar_preco')
    markTokens(PRICE)
  }
  if (HOURS.test(text)) {
    acts.push('informar_horario_funcionamento')
    markTokens(HOURS)
  }
  if (LOCAL.test(text)) {
    acts.push('informar_local')
    markTokens(LOCAL)
  }
  if (EXPLAIN.test(text)) {
    acts.push('explicar')
    markTokens(EXPLAIN)
  }
  if (DEFER.test(text)) {
    acts.push('adiar')
    markTokens(DEFER)
  }
  if (CORRECT.test(text)) {
    acts.push('corrigir')
    markTokens(CORRECT)
  }
  if (GREET.test(text)) {
    acts.push('cumprimento')
    markTokens(text)
  }
  if (AFFIRM.test(text.trim())) {
    acts.push('afirmar')
    markTokens(text)
  }
  if (DENY.test(text.trim())) {
    acts.push('negar')
    markTokens(text)
  }

  const pendingHit = matchPendingOption(text, input.pending ?? null)
  if (pendingHit) {
    acts.push('escolher_opcao')
    slots.optionIndex = field(pendingHit.index, messageId, pendingHit.label)
    // Cobertura sobre o texto da cliente (não sobre o rótulo da opção).
    markTokens(text)
  }

  const servicesHit = input.services.filter(
    (s) => citesServiceName(text, s.name) || text.toLowerCase().includes(s.name.trim().toLowerCase()),
  )
  if (servicesHit.length === 1) {
    const s = servicesHit[0]!
    slots.serviceId = field(s.id, messageId, s.name)
    markTokens(s.name)
    acts.push('marcar')
  } else if (servicesHit.length > 1) {
    for (const s of servicesHit) markTokens(s.name)
    acts.push('marcar')
  }

  for (const s of input.services) {
    const named = zonesNamedInText(
      text,
      s.zones.filter((z) => z.active),
    )
    if (named.length === 0) continue
    slots.serviceId ??= field(s.id, messageId, s.name)
    slots.variantIds = field(
      named.map((z) => z.id),
      messageId,
      named.map((z) => z.name).join(', '),
    )
    for (const z of named) markTokens(z.name)
    if (!acts.includes('marcar')) acts.push('marcar')
  }

  if (/\bfeminina\b|\bfeminino\b/i.test(text)) {
    slots.line = field('feminino', messageId, 'feminina')
    markTokens('feminina')
  } else if (/\bmasculina\b|\bmasculino\b/i.test(text)) {
    slots.line = field('masculino', messageId, 'masculina')
    markTokens('masculina')
  }

  for (const p of input.professionals ?? []) {
    const name = p.name.trim()
    if (name.length < 2) continue
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (re.test(text)) {
      slots.professionalId = field(p.id, messageId, name)
      markTokens(name)
      break
    }
  }

  const temporal = parseTemporal(text, input.today)
  if (temporal.dates.length === 1 && !temporal.dateConflict && !temporal.invalidDateMention) {
    slots.date = field(temporal.dates[0]!, messageId, temporal.dates[0]!)
    markTokens(temporal.dates[0]!)
  } else if (temporal.relative.length > 0 || temporal.dates.length > 0) {
    // Mantém o trecho para o extrator / parser; cobertura parcial.
    const lit = text.slice(0, 80)
    slots.dateLiteral = field(lit, messageId, lit)
    for (const r of temporal.relative) markTokens(r)
  }
  if (temporal.periods.length === 1) {
    slots.period = field(temporal.periods[0]!, messageId, temporal.periods[0]!)
    markTokens(temporal.periods[0]!)
  }
  if (temporal.times.length === 1) {
    slots.time = field(temporal.times[0]!, messageId, temporal.times[0]!)
    markTokens(text)
  } else {
    const times = extractTimes(text)
    if (times.size === 1) {
      const t = [...times][0]!
      slots.time = field(t, messageId, t)
      markTokens(text)
    }
  }
  // Datas via extractDates quando parseTemporal deixou várias.
  if (!slots.date) {
    const dates = extractDates(text, input.today)
    if (dates.size === 1) {
      const d = [...dates][0]!
      slots.date = field(d, messageId, d)
      markTokens(d)
    }
  }

  if (BOOK.test(text) && !acts.includes('marcar')) {
    acts.push('marcar')
    markTokens(BOOK)
  }
  if (ORDINAL.test(text) && !acts.includes('escolher_opcao')) {
    markTokens(ORDINAL)
  }

  const hasSlots =
    slots.serviceId != null ||
    slots.variantIds != null ||
    slots.date != null ||
    slots.time != null ||
    slots.period != null ||
    slots.optionIndex != null ||
    slots.line != null

  if (acts.length === 0) {
    if (hasSlots) acts.push('marcar')
    else acts.push('desconhecido')
  }

  const coverage =
    tokens.length === 0 ? 1 : Math.min(1, explained.size / Math.max(1, tokens.length))
  // Slots já resolvidos deterministicamente: não chama o extrator.
  const needsExtractor =
    !hasSlots && (coverage < COVERAGE_THRESHOLD || acts.includes('desconhecido'))

  return { acts, slots, coverage, needsExtractor }
}
