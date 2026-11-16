import { describe, expect, it } from 'vitest'
import { parseThinkingMode, thinkingPayloadForMode } from './thinking'

describe('thinking mode (proposta H9)', () => {
  it('default omite payload', () => {
    expect(thinkingPayloadForMode('default')).toBeUndefined()
    expect(thinkingPayloadForMode(undefined)).toBeUndefined()
  })
  it('off envia disabled', () => {
    expect(thinkingPayloadForMode('off')).toEqual({ type: 'disabled' })
  })
  it('minimal envia budget', () => {
    expect(thinkingPayloadForMode('minimal', 512)).toEqual({
      type: 'enabled',
      budget_tokens: 512,
    })
  })
  it('parseThinkingMode só aceita off|minimal', () => {
    expect(parseThinkingMode(undefined)).toBe('default')
    expect(parseThinkingMode('off')).toBe('off')
    expect(parseThinkingMode('nonsense')).toBe('default')
  })
})