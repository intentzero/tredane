/**
 * Cálculo de sinal em centavos inteiros — sem ponto flutuante (REQ-076 / DEC-047).
 */

import type { MoneyCents } from './types'

export type SignalKind = 'fixed' | 'percent'

export type ServiceSignalConfig = {
  requiresSignal: boolean
  kind: SignalKind | null
  /** Centavos quando kind=fixed. */
  fixedCents: MoneyCents | null
  /** Percentual inteiro 1–100 quando kind=percent. */
  percent: number | null
}

export type SignalAmountError =
  | 'signal_not_required'
  | 'signal_incomplete'
  | 'percent_requires_price'
  | 'invalid_fixed'
  | 'invalid_percent'
  | 'amount_non_positive'

export type SignalAmountResult =
  | { ok: true; amountCents: MoneyCents }
  | { ok: false; code: SignalAmountError; message: string }

const MAX_FIXED_CENTS = 10_000_000 // R$ 100.000,00

/**
 * Calcula o valor do sinal em centavos.
 * Percentual: trunc((priceCents * percent) / 100) — aritmética inteira.
 */
export function computeSignalAmountCents(
  config: ServiceSignalConfig,
  priceCents: MoneyCents | null,
): SignalAmountResult {
  if (!config.requiresSignal) {
    return { ok: false, code: 'signal_not_required', message: 'serviço não exige sinal' }
  }
  if (config.kind === 'fixed') {
    const cents = config.fixedCents
    if (cents === null || !Number.isInteger(cents) || cents <= 0 || cents > MAX_FIXED_CENTS) {
      return {
        ok: false,
        code: 'invalid_fixed',
        message: 'sinal fixo deve ser inteiro positivo em centavos',
      }
    }
    return { ok: true, amountCents: cents }
  }
  if (config.kind === 'percent') {
    if (priceCents === null || !Number.isInteger(priceCents) || priceCents <= 0) {
      return {
        ok: false,
        code: 'percent_requires_price',
        message: 'percentual exige preço cadastrado positivo',
      }
    }
    const percent = config.percent
    if (percent === null || !Number.isInteger(percent) || percent < 1 || percent > 100) {
      return {
        ok: false,
        code: 'invalid_percent',
        message: 'percentual deve ser inteiro entre 1 e 100',
      }
    }
    const amount = Math.trunc((priceCents * percent) / 100)
    if (amount <= 0) {
      return {
        ok: false,
        code: 'amount_non_positive',
        message: 'valor calculado do sinal deve ser positivo',
      }
    }
    return { ok: true, amountCents: amount }
  }
  return {
    ok: false,
    code: 'signal_incomplete',
    message: 'sinal exigido sem tipo (fixo ou percentual)',
  }
}

export function assertValidSignalConfig(
  config: ServiceSignalConfig,
  priceCents: MoneyCents | null,
): SignalAmountError | null {
  if (!config.requiresSignal) {
    if (config.kind !== null || config.fixedCents !== null || config.percent !== null) {
      // Exige sinal desligado: limpar campos no caller; aqui só valida inconsistência grave.
    }
    return null
  }
  const result = computeSignalAmountCents(config, priceCents)
  if (result.ok) return null
  if (result.code === 'signal_not_required') return null
  return result.code
}

/** Prazo padrão Confirmado (DEC-047): 2 horas. */
export const DEFAULT_SIGNAL_DEADLINE_SECONDS = 2 * 60 * 60

/** Limites ajustáveis pela owner (M-33). */
export const MIN_SIGNAL_DEADLINE_SECONDS = 15 * 60
export const MAX_SIGNAL_DEADLINE_SECONDS = 48 * 60 * 60
