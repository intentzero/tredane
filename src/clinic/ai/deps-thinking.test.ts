import { describe, expect, it } from 'vitest'
import { rpcDepsFromEnv, toAiAssistDeps } from './deps'

describe('AI_EXTRACTOR_THINKING_MODE (proposta H9)', () => {
  it('default omite modo no RPC e nos deps', () => {
    expect(rpcDepsFromEnv({}).extractorThinkingMode).toBeUndefined()
    expect(toAiAssistDeps(rpcDepsFromEnv({})).extractorThinkingMode).toBeUndefined()
  })
  it('off e minimal propagam', () => {
    expect(rpcDepsFromEnv({ AI_EXTRACTOR_THINKING_MODE: 'off' }).extractorThinkingMode).toBe('off')
    expect(
      toAiAssistDeps(rpcDepsFromEnv({ AI_EXTRACTOR_THINKING_MODE: 'minimal' })).extractorThinkingMode,
    ).toBe('minimal')
  })
  it('valores desconhecidos mantêm default', () => {
    expect(rpcDepsFromEnv({ AI_EXTRACTOR_THINKING_MODE: 'turbo' }).extractorThinkingMode).toBeUndefined()
  })
})