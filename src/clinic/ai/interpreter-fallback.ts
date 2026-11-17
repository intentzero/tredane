/**
 * Extrator LLM só como fallback (Paulo, 17/11/2026 — sombra 72h / DL D-20261117-082000-CUR).
 * Preenche service / line / period apenas quando o léxico deixou o campo vazio.
 */
import {
  interpreterFallbackGaps,
  type InterpreterFallbackField,
  type TurnInterpretation,
  type TurnSlots,
} from './nlu/interpret'
import { norm, stripGreetingPeriodFalsePositives } from './nlu/temporal'

export type { InterpreterFallbackField } from './nlu/interpret'
export { interpreterFallbackGaps } from './nlu/interpret'

export type InterpreterFallbackFlags = Record<InterpreterFallbackField, boolean>

export const DEFAULT_INTERPRETER_FALLBACK_FLAGS: InterpreterFallbackFlags = {
  service: true,
  line: false,
  period: false,
}

function envTriState(raw: string | undefined | null, defaultOn: boolean): boolean {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'on' || v === '1' || v === 'true') return true
  if (v === 'off' || v === '0' || v === 'false') return false
  return defaultOn
}

export function interpreterFallbackFlagsFromEnv(env: {
  AI_INTERPRETER_FALLBACK_SERVICE?: string
  AI_INTERPRETER_FALLBACK_LINE?: string
  AI_INTERPRETER_FALLBACK_PERIOD?: string
}): InterpreterFallbackFlags {
  return {
    service: envTriState(env.AI_INTERPRETER_FALLBACK_SERVICE, true),
    line: envTriState(env.AI_INTERPRETER_FALLBACK_LINE, false),
    period: envTriState(env.AI_INTERPRETER_FALLBACK_PERIOD, false),
  }
}

export function shouldRunFallbackExtractor(
  base: TurnInterpretation,
  turnText: string,
  flags: InterpreterFallbackFlags = DEFAULT_INTERPRETER_FALLBACK_FLAGS,
): boolean {
  const gaps = interpreterFallbackGaps({ acts: base.acts, slots: base.slots, turnText })
  return gaps.some((g) => flags[g])
}

/** Evidência estrita de período (DEC-079; cumprimentos e cortes de relógio fora). */
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
  fields: InterpreterFallbackField[]
  serviceId?: string
  line?: 'feminino' | 'masculino'
  period?: 'manha' | 'tarde' | 'noite'
}

export function logInterpreterFallbackApplied(e: InterpreterFallbackAppliedEvent): void {
  console.info(JSON.stringify(e))
}

/**
 * Mantém só service/line/period do LLM quando o léxico estava vazio e o flag permite.
 * Variantes, opção, data/hora/profissional nunca vêm do fallback.
 */
export function enforceInterpreterFallbackPolicy(
  slots: TurnSlots,
  base: TurnSlots,
  discarded: string[],
  flags: InterpreterFallbackFlags = DEFAULT_INTERPRETER_FALLBACK_FLAGS,
): InterpreterFallbackField[] {
  const applied: InterpreterFallbackField[] = []
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
  ] as const) {
    revertLlm(key)
  }

  if (!flags.service || base.serviceId) revertLlm('serviceId')
  else if (slots.serviceId?.fonte === 'llm') applied.push('service')

  if (!flags.line || base.line) revertLlm('line')
  else if (slots.line?.fonte === 'llm') applied.push('line')

  if (!flags.period || base.period) revertLlm('period')
  else if (slots.period?.fonte === 'llm') applied.push('period')

  return applied
}