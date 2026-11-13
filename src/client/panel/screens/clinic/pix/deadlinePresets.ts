/**
 * M-33 / DEC-179 — prazo do Pix em presets + Outro…
 * UI trabalha em minutos; API/servidor guardam `deadlineSeconds` (= minutos × 60).
 */
import {
  MAX_SIGNAL_DEADLINE_SECONDS,
  MIN_SIGNAL_DEADLINE_SECONDS,
} from '../../../../../pix/money'

/** Presets Confirmados (DEC-179): 15 min … 48 h. */
export const SIGNAL_DEADLINE_PRESETS_MINUTES = [
  15, 30, 60, 120, 360, 1440, 2880,
] as const

export type SignalDeadlinePresetMinutes =
  (typeof SIGNAL_DEADLINE_PRESETS_MINUTES)[number]

export const MIN_SIGNAL_DEADLINE_MINUTES = MIN_SIGNAL_DEADLINE_SECONDS / 60
export const MAX_SIGNAL_DEADLINE_MINUTES = MAX_SIGNAL_DEADLINE_SECONDS / 60

/** Padrão DEC-047: 2 h. */
export const DEFAULT_SIGNAL_DEADLINE_MINUTES = 120

/** Valor inicial do «Outro…» quando se sai de um preset. */
export const OTHER_DEADLINE_SEED_MINUTES = 90

export type DeadlineUnit = 'min' | 'h'

export function secondsToMinutes(seconds: number): number {
  return Math.round(seconds / 60)
}

export function minutesToSeconds(minutes: number): number {
  return Math.round(minutes * 60)
}

export function isDeadlinePreset(minutes: number): minutes is SignalDeadlinePresetMinutes {
  return (SIGNAL_DEADLINE_PRESETS_MINUTES as readonly number[]).includes(minutes)
}

export function isDeadlineMinutesValid(minutes: number): boolean {
  return (
    Number.isInteger(minutes)
    && minutes >= MIN_SIGNAL_DEADLINE_MINUTES
    && minutes <= MAX_SIGNAL_DEADLINE_MINUTES
  )
}

/** Rótulo dos chips (15 min, 1 h, 2 h…). */
export function formatDeadlinePresetLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  if (Number.isInteger(hours)) return `${hours} h`
  return `${minutes} min`
}

/**
 * Parte um valor em minutos para o formulário «Outro…»:
 * múltiplos de 60 → unidade h; senão → min.
 */
export function splitCustomDeadline(minutes: number): {
  amount: number
  unit: DeadlineUnit
} {
  if (minutes > 0 && minutes % 60 === 0) {
    return { amount: minutes / 60, unit: 'h' }
  }
  return { amount: minutes, unit: 'min' }
}

export function combineCustomDeadline(amount: number, unit: DeadlineUnit): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  const minutes = unit === 'h' ? Math.round(amount * 60) : Math.round(amount)
  if (!Number.isInteger(minutes)) return null
  return minutes
}
