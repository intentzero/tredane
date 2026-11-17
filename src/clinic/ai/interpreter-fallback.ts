/**
 * Extrator LLM só como fallback de **serviço** (Paulo, 17/11/2026 — DL D-20261117-091300-CUR).
 * Line e período ficam só no léxico; variante/opção nunca vêm do modelo.
 */
import {
  interpreterFallbackGaps,
  type TurnInterpretation,
  type TurnSlots,
} from './nlu/interpret'
import { norm, stripGreetingPeriodFalsePositives } from './nlu/temporal'

export { interpreterFallbackGaps } from './nlu/interpret'

export type InterpreterFallbackConfig = { service: boolean }

export const DEFAULT_INTERPRETER_FALLBACK: InterpreterFallbackConfig = { service: true }

function envTriState(raw: string | undefined | null, defaultOn: boolean): boolean {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'on' || v === '1' || v === 'true') return true
  if (v === 'off' || v === '0' || v === 'false') return false
  return defaultOn
}

export function interpreterFallbackConfigFromEnv(env: {
  AI_INTERPRETER_FALLBACK_SERVICE?: string
}): InterpreterFallbackConfig {
  return { service: envTriState(env.AI_INTERPRETER_FALLBACK_SERVICE, true) }
}

export function shouldRunFallbackExtractor(
  base: TurnInterpretation,
  turnText: string,
  config: InterpreterFallbackConfig = DEFAULT_INTERPRETER_FALLBACK,
): boolean {
  if (!config.service) return false
  return interpreterFallbackGaps({ acts: base.acts, slots: base.slots, turnText }).includes('service')
}

/** Evidência estrita de período na sombra / validação do extrator (line e period não aplicam no atendimento). */
export function periodModelEvidence(turnText: string, period: 'manha' | 'tarde' | 'noite'): boolean {
  const folded = norm(turnText)
  if (/\bmeio\s+dia\b/.test(folded)) return false
  if (/\b(?:antes|depois|dps)\s+das?\s+[0-9]/.test(folded)) return false
  if (period === 'tarde' && /\b(?:depois|apos|dps)\s+(?:do|de)\s+almoco\b/.test(folded)) return true
  const stripped = stripGreetingPeriodFalsePositives(folded)
  return new RegExp(`\\b${period}\\b`).test(stripped)
}

export type InterpreterFallbackAppliedEvent = {
  level: 'info'
  event: 'ai.interpreter_fallback_applied'
  tenantId: string
  conversationId: string
  messageId: string
  fields: ['service']
  serviceId: string
}

export function logInterpreterFallbackApplied(e: InterpreterFallbackAppliedEvent): void {
  console.info(JSON.stringify(e))
}

/**
 * Mantém só serviceId do LLM quando o léxico estava vazio e o fallback está ligado.
 * Todo o resto (line, period, variantes, opção, data/hora) reverte ou descarta.
 */
export function enforceInterpreterFallbackPolicy(
  slots: TurnSlots,
  base: TurnSlots,
  discarded: string[],
  config: InterpreterFallbackConfig = DEFAULT_INTERPRETER_FALLBACK,
): boolean {
  const revertLlm = (key: keyof TurnSlots) => {
    const cur = slots[key]
    if (cur?.fonte !== 'llm') return
    const prev = base[key]
    const slotMap = slots as Record<keyof TurnSlots, TurnSlots[keyof TurnSlots] | undefined>
    if (prev) slotMap[key] = prev
    else delete slotMap[key]
    if (!discarded.includes(String(key))) discarded.push(String(key))
  }

  for (const key of [
    'variantIds',
    'professionalId',
    'date',
    'dateLiteral',
    'time',
    'optionIndex',
    'line',
    'period',
  ] as const) {
    revertLlm(key)
  }

  if (!config.service || base.serviceId) {
    revertLlm('serviceId')
    return false
  }
  return slots.serviceId?.fonte === 'llm'
}