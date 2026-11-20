/**
 * Debounce adaptativo DEC-111 (#413 / item 5 da #402).
 * 0 s botão/lista · 2–3 s pedido completo · 300 ms cumprimento do hub · 7 s texto aberto.
 * Revisão Paulo 04/11/2026 (opção C): cumprimento do hub não espera 7 s;
 * dia+período («amanhã tarde») mantém 2,5 s mesmo se VAGUE_BOOK casar «horário».
 * P2 Paulo 07/11/2026: resposta curta a pending aberta → 0–300 ms (evolui DEC-111).
 * Revisão Paulo 16/11/2026: quando `interpretTurn` resolve sem `needsExtractor`,
 * a bolha em curso usa o mesmo tier curto (2,5 s) mesmo fora da heurística
 * `looksLikeCompleteBookingRequest`; texto longo/frágil ou cobertura baixa mantém 7 s.
 */
import { AI_AUTODRAFT_DEBOUNCE_MS } from '../../ai/budgets'
import { isGreetingOnly as isHubGreetingText } from '../../clientweb/route-intent'
import {
  COVERAGE_THRESHOLD,
  interpretTurn,
  type InterpretInput,
  type TurnInterpretation,
} from './nlu/interpret'
import { hasBookingDayPartCue, parseTemporal, withoutGreetingPeriodFalsePositives } from './nlu/temporal'

/**
 * 2,5 s — meio da faixa 2–3 s da DEC-111 e acima do debounce de agregação típico
 * (segunda bolha 1–5 s): ainda dá tempo de empurrar o job se chegar mais texto.
 */
export const AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS = 2_500
/** Alias explícito para o tier guiado pelo interpretador (mesmo valor que complete). */
export const AI_AUTODRAFT_DEBOUNCE_INTERPRETER_CONFIDENT_MS =
  AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS
export const AI_AUTODRAFT_DEBOUNCE_INTERACTIVE_MS = 0
/**
 * Cumprimento / «tudo bem» do hub (`isHubGreetingText` / GREET_ONLY|VAGUE_ASK).
 * 300 ms: dentro da faixa 0–500 ms da opção C — cobre uma segunda bolha quase
 * simultânea sem o vácuo de 7 s do texto aberto. Não cobre dia+período.
 */
export const AI_AUTODRAFT_DEBOUNCE_HUB_MS = 300
/**
 * Resposta curta a obrigação pendente (ask-tipo / horários / eco / linha).
 * Paulo P2 07/11/2026: 0–300 ms — cobre «Axila», «14h», «sim» sem o atraso de 7 s.
 */
export const AI_AUTODRAFT_DEBOUNCE_PENDING_MS = 300
/** Limite de comprimento para tratar a resposta ao pending como «curta e completa». */
export const PENDING_SHORT_ANSWER_MAX_CHARS = 40
/**
 * Acima disto, só encurta o debounce se o interpretador cobrir o turno com
 * slots/atos claros (multi-zona nomeada no léxico, por exemplo).
 */
export const DEBOUNCE_OPEN_TEXT_LONG_CHARS = 160

export type AutodraftDebounceInput = {
  text: string
  /** Toque em botão ou lista WhatsApp (resposta completa). */
  fromInteractive?: boolean
  /**
   * Abertura do hub (`shouldOfferHubOpening`), mas o 300 ms só aplica se o
   * texto não for pedido completo (dia/hora/período). Cumprimentos puros
   * (`isHubGreetingText`) nunca contam como pedido completo.
   */
  hubOpening?: boolean
  /**
   * `BookingFrame.pending.slot` aberto (ChoiceSlot). Com texto curto → 300 ms
   * (vence o tier complete para «14h» / nome de variante).
   */
  pendingSlot?: string | null
  /** Resultado de `interpretTurn` para o turno da bolha em fila (opcional). */
  interpretation?: TurnInterpretation
}

/**
 * Heurística: mensagem com sinal de dia/hora (e tipicamente serviço) = pedido completo.
 * O harness e o funil já avançam o relógio; o valor afecta sobretudo a latência real.
 */
export function looksLikeCompleteBookingRequest(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  // «Boa noite» / «Oi» não são pedido completo (opção C — debounce curto do hub).
  if (isHubGreetingText(trimmed)) return false
  const temporal = parseTemporal(trimmed, { civilDate: '1970-01-01' })
  const hasTime = temporal.times.length > 0 || temporal.ambiguousAfternoonHour != null
  // Cumprimento «boa tarde» não conta como período (TRE-60); parseTemporal já faz strip.
  const hasPeriod = temporal.periods.length > 0 || hasBookingDayPartCue(trimmed)
  const dayProbe = withoutGreetingPeriodFalsePositives(trimmed)
  const hasDay =
    temporal.dates.length > 0 ||
    temporal.relative.length > 0 ||
    /\b(hoje|amanha|esta\s+(?:manha|tarde|noite)|segunda|terca|quarta|quinta|sexta|sabado|domingo|\d{1,2}\/\d{1,2})\b/i.test(
      dayProbe,
    )
  const hasServiceCue =
    /\b(quero|gostaria|marcar|agendar|limpeza|massagem|depil|peeling|bronze|microagulh)\b/i.test(
      trimmed,
    )
  // Pedido completo clássico: serviço + (dia ou hora).
  if (hasServiceCue && (hasDay || hasTime || hasPeriod)) return true
  // Resposta que fecha o funil («14h», «amanhã à tarde», «sexta de manhã»).
  if (hasTime && trimmed.length <= 40) return true
  if ((hasDay || hasPeriod) && trimmed.length <= 80) return true
  return false
}

/** Resposta curta e completa à pergunta pendente (Paulo P2 07/11/2026). */
export function looksLikeShortPendingAnswer(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.length > PENDING_SHORT_ANSWER_MAX_CHARS) return false
  // Multi-zona longa («axila e pernas e buço…») fica no debounce normal.
  if ((trimmed.match(/\be\b/gi) ?? []).length >= 2) return false
  return true
}

/** Trecho que parece o cliente ainda a escrever (não fecha o turno sozinho). */
export function looksLikeSplitTypingFragment(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (t.length <= 2) return true
  if (/[,;:…]\s*$/.test(t)) return true
  if (/\be\s*$/i.test(t)) return true
  if (/^(oi|ol[aá]|bom dia|boa tarde|boa noite)\s*$/i.test(t)) return false
  return false
}

const CLEAR_FAQ_ACTS = new Set<TurnInterpretation['acts'][number]>([
  'informar_preco',
  'informar_horario_funcionamento',
  'informar_local',
  'explicar',
])

function turnHasResolvedSlots(slots: TurnInterpretation['slots']): boolean {
  return (
    slots.serviceId != null ||
    slots.variantIds != null ||
    slots.date != null ||
    slots.dateLiteral != null ||
    slots.time != null ||
    slots.period != null ||
    slots.optionIndex != null ||
    slots.line != null
  )
}

/**
 * O interpretador determinístico fechou o turno sem extrator — sim/não, hora/data,
 * toque simulado, FAQ de catálogo, ou pedido com slots cobertos.
 */
export function interpreterResolvesTurnConfidently(
  interp: TurnInterpretation,
  text: string,
): boolean {
  if (interp.needsExtractor) return false
  if (interp.acts.includes('desconhecido')) return false
  if (interp.acts.includes('corrigir')) return false
  if (interp.coverage < COVERAGE_THRESHOLD) return false
  const trimmed = text.trim()
  if (looksLikeSplitTypingFragment(trimmed)) return false

  if (interp.acts.includes('afirmar') || interp.acts.includes('negar')) {
    return trimmed.length <= PENDING_SHORT_ANSWER_MAX_CHARS
  }
  if (interp.slots.optionIndex != null || interp.acts.includes('escolher_opcao')) return true
  if (interp.slots.time != null || interp.slots.date != null || interp.slots.period != null) {
    return true
  }
  if (interp.acts.some((a) => CLEAR_FAQ_ACTS.has(a)) && turnHasResolvedSlots(interp.slots)) {
    return true
  }
  if (turnHasResolvedSlots(interp.slots) && interp.acts.includes('marcar')) {
    return trimmed.length <= DEBOUNCE_OPEN_TEXT_LONG_CHARS
  }
  if (
    turnHasResolvedSlots(interp.slots) &&
    trimmed.length <= PENDING_SHORT_ANSWER_MAX_CHARS &&
    interp.coverage >= 0.75
  ) {
    return true
  }
  return false
}

/** Interpretação determinística usada só para escolher o debounce ao enfileirar. */
export function interpretTurnForDebounce(input: InterpretInput): TurnInterpretation {
  return interpretTurn(input)
}

export function autodraftDebounceMs(input: AutodraftDebounceInput): number {
  if (input.fromInteractive) return AI_AUTODRAFT_DEBOUNCE_INTERACTIVE_MS
  // Pending aberto + resposta curta: 300 ms (vence complete para «14h» / «Axila»).
  if (input.pendingSlot && looksLikeShortPendingAnswer(input.text)) {
    return AI_AUTODRAFT_DEBOUNCE_PENDING_MS
  }
  // Dia+período / pedido completo antes do hub: «amanhã tarde» e «tem horário?»
  // casam VAGUE_BOOK mas devem ficar nos 2,5 s da DEC-111.
  if (looksLikeCompleteBookingRequest(input.text)) return AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS
  if (
    input.interpretation &&
    interpreterResolvesTurnConfidently(input.interpretation, input.text)
  ) {
    return AI_AUTODRAFT_DEBOUNCE_INTERPRETER_CONFIDENT_MS
  }
  if (input.hubOpening) return AI_AUTODRAFT_DEBOUNCE_HUB_MS
  return AI_AUTODRAFT_DEBOUNCE_MS
}

/** Typing durante o debounce (hub/pending/tier 2,5 s quando o turno está fechado). */
export function shouldEnqueueTypingDuringDebounce(
  waitMs: number,
  text: string,
  interpretation?: TurnInterpretation,
): boolean {
  if (waitMs === AI_AUTODRAFT_DEBOUNCE_HUB_MS || waitMs === AI_AUTODRAFT_DEBOUNCE_PENDING_MS) {
    return true
  }
  if (waitMs !== AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS) return false
  return (
    looksLikeCompleteBookingRequest(text) ||
    (interpretation != null && interpreterResolvesTurnConfidently(interpretation, text))
  )
}
