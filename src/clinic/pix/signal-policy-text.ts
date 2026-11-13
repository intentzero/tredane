/**
 * DEC-180 — texto à cliente gerado a partir das regras do sinal (Recebimento).
 * «Outro…» sobrescreve; sem estorno Pix («Devolve» fora do desenho).
 */

import type { SignalKind } from '../../pix/money'

export type SignalPolicyKind = 'credit_next' | 'keep' | 'custom'

export type SignalPolicyTextInput = {
  amountKind: SignalKind
  fixedCents: number | null
  percent: number | null
  deadlineSeconds: number
  policyKind: SignalPolicyKind
  /** Só com credit_next: 12 | 24 | 48. */
  creditWindowHours: number | null
  customPolicyText?: string | null
}

export type SignalPolicyPreview = {
  booking: string
  reschedule: string
  cancel: string
  /** Texto único gravado em cancellation_policy / snapshot (compatível DEC-047). */
  combined: string
  generated: boolean
}

function formatBrl(cents: number): string {
  const reais = Math.trunc(cents / 100)
  const rest = Math.abs(cents % 100)
    .toString()
    .padStart(2, '0')
  return `R$\u00a0${reais},${rest}`
}

export function formatDeadlineHuman(seconds: number): string {
  if (seconds % 3600 === 0) {
    const h = seconds / 3600
    return h === 1 ? '1\u00a0h' : `${h}\u00a0h`
  }
  if (seconds % 60 === 0) {
    const m = seconds / 60
    return m === 1 ? '1\u00a0min' : `${m}\u00a0min`
  }
  return `${seconds}\u00a0s`
}

function amountPhrase(input: SignalPolicyTextInput): string {
  if (input.amountKind === 'percent' && input.percent != null) {
    return `${input.percent}% do serviço`
  }
  if (input.fixedCents != null && input.fixedCents > 0) {
    return formatBrl(input.fixedCents)
  }
  return 'o valor configurado'
}

function windowPhrase(hours: number | null): string {
  const h = hours === 12 || hours === 48 ? hours : 24
  return `${h}\u00a0h`
}

/**
 * Gera as três frases (agendar / remarcar / cancelar) ou devolve o texto custom.
 */
export function buildSignalPolicyPreview(input: SignalPolicyTextInput): SignalPolicyPreview {
  if (input.policyKind === 'custom') {
    const custom = (input.customPolicyText ?? '').trim()
    return {
      booking: custom,
      reschedule: custom,
      cancel: custom,
      combined: custom,
      generated: false,
    }
  }

  const amount = amountPhrase(input)
  const deadline = formatDeadlineHuman(input.deadlineSeconds)
  const booking =
    `Para reservar, pague o sinal de ${amount} por Pix em até ${deadline}. ` +
    `O horário só fica reservado depois do pagamento.`

  if (input.policyKind === 'keep') {
    const reschedule =
      'Se remarcar depois de pagar, o sinal já pago não se devolve e não vale para o novo horário.'
    const cancel =
      'Em caso de cancelamento depois do pagamento, o sinal fica com a clínica. Não há devolução por Pix.'
    return {
      booking,
      reschedule,
      cancel,
      combined: `${booking}\n\n${reschedule}\n\n${cancel}`,
      generated: true,
    }
  }

  // credit_next
  const win = windowPhrase(input.creditWindowHours)
  const reschedule =
    `Se remarcar com pelo menos ${win} de antecedência, o sinal já pago vale para o novo horário. ` +
    `Não há devolução por Pix.`
  const cancel =
    `Cancelamento com pelo menos ${win} de antecedência: o sinal fica como crédito para o próximo horário. ` +
    `Com menos de ${win}, o sinal não se devolve.`

  return {
    booking,
    reschedule,
    cancel,
    combined: `${booking}\n\n${reschedule}\n\n${cancel}`,
    generated: true,
  }
}
