import { describe, expect, it } from 'vitest'
import { AI_AUTODRAFT_DEBOUNCE_MS } from '../../ai/budgets'
import {
  AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS,
  AI_AUTODRAFT_DEBOUNCE_INTERACTIVE_MS,
  autodraftDebounceMs,
  looksLikeCompleteBookingRequest,
} from './debounce'

describe('debounce DEC-111', () => {
  it('botão/lista → 0 s', () => {
    expect(autodraftDebounceMs({ text: 'Confirmar', fromInteractive: true })).toBe(
      AI_AUTODRAFT_DEBOUNCE_INTERACTIVE_MS,
    )
  })

  it('pedido completo → 2–3 s', () => {
    expect(looksLikeCompleteBookingRequest('Quero limpeza de pele amanhã às 15h')).toBe(true)
    expect(autodraftDebounceMs({ text: 'Quero limpeza de pele amanhã às 15h' })).toBe(
      AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS,
    )
  })

  it('texto aberto → 7 s', () => {
    expect(looksLikeCompleteBookingRequest('Oi, tudo bem?')).toBe(false)
    expect(autodraftDebounceMs({ text: 'Oi, tudo bem?' })).toBe(AI_AUTODRAFT_DEBOUNCE_MS)
  })
})
