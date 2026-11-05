/**
 * Debounce adaptativo DEC-111 (#413 / item 5 da #402).
 * 0 s botão/lista · 2–3 s pedido completo · 300 ms cumprimento do hub · 7 s texto aberto.
 * Revisão Paulo 04/11/2026 (opção C): cumprimento do hub não espera 7 s;
 * dia+período («amanhã tarde») mantém 2,5 s mesmo se VAGUE_BOOK casar «horário».
 */
import { AI_AUTODRAFT_DEBOUNCE_MS } from '../../ai/budgets'
import { isHubGreetingText } from '../../whatsapp/flow/hub-opening'
import { parseTemporal } from './nlu/temporal'

/** 2,5 s no meio da faixa 2–3 s da DEC-111. */
export const AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS = 2_500
export const AI_AUTODRAFT_DEBOUNCE_INTERACTIVE_MS = 0
/**
 * Cumprimento / «tudo bem» do hub (`isHubGreetingText` / GREET_ONLY|VAGUE_ASK).
 * 300 ms: dentro da faixa 0–500 ms da opção C — cobre uma segunda bolha quase
 * simultânea sem o vácuo de 7 s do texto aberto. Não cobre dia+período.
 */
export const AI_AUTODRAFT_DEBOUNCE_HUB_MS = 300

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
  const hasPeriod =
    temporal.periods.length > 0 || /\b(manh[aã]|tarde|noite)\b/i.test(trimmed)
  const hasDay =
    temporal.dates.length > 0 ||
    temporal.relative.length > 0 ||
    /\b(hoje|amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|\d{1,2}\/\d{1,2})\b/i.test(
      trimmed,
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

export function autodraftDebounceMs(input: AutodraftDebounceInput): number {
  if (input.fromInteractive) return AI_AUTODRAFT_DEBOUNCE_INTERACTIVE_MS
  // Dia+período / pedido completo antes do hub: «amanhã tarde» e «tem horário?»
  // casam VAGUE_BOOK mas devem ficar nos 2,5 s da DEC-111.
  if (looksLikeCompleteBookingRequest(input.text)) return AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS
  if (input.hubOpening) return AI_AUTODRAFT_DEBOUNCE_HUB_MS
  return AI_AUTODRAFT_DEBOUNCE_MS
}
