/**
 * M-33 / DEC-182 — prazo do Pix só 15 min ou 30 min (revê DEC-179).
 * UI trabalha em minutos; API/servidor guardam `deadlineSeconds` (= minutos × 60).
 * Helpers de «Outro…» (número + unidade) servem antecedência e janela de crédito.
 */
import {
  MAX_SIGNAL_DEADLINE_SECONDS,
  MIN_SIGNAL_DEADLINE_SECONDS,
} from '../../../../../pix/money'

/** Presets Confirmados (DEC-182): só 15 min e 30 min. */
export const SIGNAL_DEADLINE_PRESETS_MINUTES = [15, 30] as const

export type SignalDeadlinePresetMinutes =
  (typeof SIGNAL_DEADLINE_PRESETS_MINUTES)[number]

export const MIN_SIGNAL_DEADLINE_MINUTES = MIN_SIGNAL_DEADLINE_SECONDS / 60
export const MAX_SIGNAL_DEADLINE_MINUTES = MAX_SIGNAL_DEADLINE_SECONDS / 60

/** Padrão DEC-182: 30 min (revê DEC-047 / DEC-179). */
export const DEFAULT_SIGNAL_DEADLINE_MINUTES = 30

/** Presets de antecedência mínima (0 = Desligado). */
export const BOOKING_LEAD_PRESETS_MINUTES = [0, 30, 60] as const

/** Valor inicial do «Outro…» de antecedência. */
export const OTHER_LEAD_SEED_MINUTES = 120

/** Presets de janela de crédito (minutos). */
export const CREDIT_WINDOW_PRESETS_MINUTES = [12 * 60, 24 * 60, 48 * 60] as const

/** Valor inicial do «Outro…» de janela. */
export const OTHER_CREDIT_WINDOW_SEED_MINUTES = 36 * 60

/** Número customizado: máx. 2 dígitos (1–99). */
export const CUSTOM_AMOUNT_MAX_DIGITS = 2
export const CUSTOM_AMOUNT_MAX = 99

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
    && isDeadlinePreset(minutes)
  )
}

/** Mapeia prazo legado (fora de 15/30) para o padrão 30 min. */
export function normalizeDeadlineMinutes(minutes: number): SignalDeadlinePresetMinutes {
  if (minutes === 15) return 15
  return 30
}

/** Rótulo dos chips de prazo (15 min, 30 min). */
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
  if (!Number.isInteger(amount) || amount > CUSTOM_AMOUNT_MAX) return null
  const minutes = unit === 'h' ? amount * 60 : amount
  if (!Number.isInteger(minutes) || minutes <= 0) return null
  return minutes
}

/** Aceita só dígitos, máx. 2 caracteres. */
export function sanitizeCustomAmountInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CUSTOM_AMOUNT_MAX_DIGITS)
}

export function isBookingLeadPreset(minutes: number): boolean {
  return (BOOKING_LEAD_PRESETS_MINUTES as readonly number[]).includes(minutes)
}

export function isCreditWindowPreset(minutes: number): boolean {
  return (CREDIT_WINDOW_PRESETS_MINUTES as readonly number[]).includes(minutes)
}

/** Custom lead/window: 1–99 min ou 1–99 h. */
export function isCustomDurationValid(minutes: number | null): boolean {
  if (minutes == null || !Number.isInteger(minutes) || minutes <= 0) return false
  return minutes <= CUSTOM_AMOUNT_MAX * 60
}
