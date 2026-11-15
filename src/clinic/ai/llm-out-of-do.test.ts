import { describe, expect, it } from 'vitest'
import { DEMO_CLINIC_TENANT_ID } from '../demo/ids'
import { llmOutOfDoEnabled, parseLlmOutOfDoMode } from './llm-out-of-do'

describe('llmOutOfDo flag (DEC-188)', () => {
  it('parse modes', () => {
    expect(parseLlmOutOfDoMode(undefined)).toBe('off')
    expect(parseLlmOutOfDoMode('demo')).toBe('demo')
    expect(parseLlmOutOfDoMode('on')).toBe('on')
    expect(parseLlmOutOfDoMode('ALL')).toBe('on')
  })

  it('demo mode só no tenant demo', () => {
    expect(llmOutOfDoEnabled({ LLM_OUT_OF_DO: 'demo' }, DEMO_CLINIC_TENANT_ID)).toBe(true)
    expect(llmOutOfDoEnabled({ LLM_OUT_OF_DO: 'demo' }, 'clinic-other')).toBe(false)
  })

  it('on mode em qualquer tenant', () => {
    expect(llmOutOfDoEnabled({ LLM_OUT_OF_DO: 'on' }, 'clinic-other')).toBe(true)
  })
})
