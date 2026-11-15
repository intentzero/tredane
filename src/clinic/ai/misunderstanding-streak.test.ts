import { describe, expect, it } from 'vitest'
import {
  CONSECUTIVE_MISUNDERSTANDING_THRESHOLD,
  isMisunderstandingOutboundBody,
  shouldEscalateAfterMisunderstanding,
} from './misunderstanding-streak'
import { MODEL_FALLBACK_TEXT } from './model-fallback'

describe('misunderstanding streak (fundador 15/11/2026)', () => {
  it('limiar aprovado = 2', () => {
    expect(CONSECUTIVE_MISUNDERSTANDING_THRESHOLD).toBe(2)
  })

  it('reconhece copy de incompreensão', () => {
    expect(isMisunderstandingOutboundBody(MODEL_FALLBACK_TEXT)).toBe(true)
    expect(isMisunderstandingOutboundBody('Não entendi bem esse pedido. Quer ver as opções?')).toBe(
      true,
    )
    expect(isMisunderstandingOutboundBody('Qual serviço você quer?')).toBe(false)
  })

  it('escala no limiar', () => {
    expect(shouldEscalateAfterMisunderstanding(1)).toBe(false)
    expect(shouldEscalateAfterMisunderstanding(2)).toBe(true)
  })
})