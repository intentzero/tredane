/**
 * Adeus após Terminar (pós-agendamento DEC-086, idle DEC-087, preço T3).
 * **Confirmado** (Paulo, 13/11/2026, America/Sao_Paulo): três frases mais
 * calorosas; uma escolhida ao acaso por resposta.
 *
 * Distinto do acto `acolher_adiamento` (soft-decline mid-funil / DEC-147),
 * que mantém as suas redações próprias.
 */
import { DEFAULT_CLINIC_TIMEZONE } from '../constants'
import { clinicMinuteOfDay } from '../scheduling/timezone'

/** RNG injectável — devolve [0, 1). Por defeito `Math.random`. */
export type TerminarFarewellRng = () => number

/** Índice forçado em testes (null = RNG). */
let forcedFarewellIndexForTests: number | null = null

/**
 * Força a n-ésima frase (módulo 3). `null` restaura o RNG.
 * Só para vitest.
 */
export function setTerminarFarewellIndexForTests(n: number | null): void {
  forcedFarewellIndexForTests = n
}

export type DayPartGreeting = 'Bom dia' | 'Boa tarde' | 'Boa noite'

/**
 * Saudação pelo fuso da clínica (padrão America/Sao_Paulo).
 * 05–11 → Bom dia; 12–17 → Boa tarde; 18–04 → Boa noite.
 */
export function dayPartGreeting(
  timezone: string,
  nowMs: number,
): DayPartGreeting {
  const tz = timezone.trim() || DEFAULT_CLINIC_TIMEZONE
  const hour = Math.floor(clinicMinuteOfDay(tz, nowMs) / 60)
  if (hour >= 5 && hour < 12) return 'Bom dia'
  if (hour >= 12 && hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export const TERMINAR_FAREWELL_STATIC = [
  'Perfeito. Qualquer coisa, estamos por aqui.',
  'Até lá — se precisar, é só escrever.',
] as const

export function terminarFarewellWithGreeting(greeting: DayPartGreeting): string {
  return `Combinado. ${greeting} e até a sua visita.`
}

/** Todas as frases possíveis num instante (útil em asserts). */
export function terminarFarewellCandidates(
  timezone: string,
  nowMs: number,
): readonly [string, string, string] {
  return [
    TERMINAR_FAREWELL_STATIC[0],
    TERMINAR_FAREWELL_STATIC[1],
    terminarFarewellWithGreeting(dayPartGreeting(timezone, nowMs)),
  ]
}

export function isTerminarFarewellBody(
  body: string,
  timezone: string,
  nowMs: number,
): boolean {
  return (terminarFarewellCandidates(timezone, nowMs) as readonly string[]).includes(body)
}

/**
 * Escolhe uma das três frases. `random` injectável (testes); senão Math.random
 * ou o índice forçado por `setTerminarFarewellIndexForTests`.
 */
export function pickTerminarFarewell(input: {
  timezone?: string | null
  nowMs: number
  random?: TerminarFarewellRng
}): string {
  const timezone = input.timezone?.trim() || DEFAULT_CLINIC_TIMEZONE
  const candidates = terminarFarewellCandidates(timezone, input.nowMs)
  const n = candidates.length
  let idx: number
  if (forcedFarewellIndexForTests != null) {
    idx = ((forcedFarewellIndexForTests % n) + n) % n
  } else {
    const random = input.random ?? Math.random
    const r = random()
    idx = Math.min(n - 1, Math.max(0, Math.floor(r * n)))
  }
  return candidates[idx]!
}
