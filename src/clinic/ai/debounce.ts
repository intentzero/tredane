/**
 * Debounce adaptativo DEC-111 (#413 / item 5 da #402).
 * 0 s botão/lista · 2–3 s pedido completo · 7 s texto aberto.
 */
import { AI_AUTODRAFT_DEBOUNCE_MS } from '../../ai/budgets'
import { parseTemporal } from './nlu/temporal'

/** 2,5 s no meio da faixa 2–3 s da DEC-111. */
export const AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS = 2_500
export const AI_AUTODRAFT_DEBOUNCE_INTERACTIVE_MS = 0

export type AutodraftDebounceInput = {
  text: string
  /** Toque em botão ou lista WhatsApp (resposta completa). */
  fromInteractive?: boolean
}

/**
 * Heurística: mensagem com sinal de dia/hora (e tipicamente serviço) = pedido completo.
 * O harness e o funil já avançam o relógio; o valor afecta sobretudo a latência real.
 */
export function looksLikeCompleteBookingRequest(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
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
  if (looksLikeCompleteBookingRequest(input.text)) return AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS
  return AI_AUTODRAFT_DEBOUNCE_MS
}
