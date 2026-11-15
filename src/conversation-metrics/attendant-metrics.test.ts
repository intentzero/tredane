import { describe, expect, it } from 'vitest'
import {
  MISUNDERSTANDING_ESC_CLIENT_PREFIX,
  resolveAttendantRequestSource,
} from './attendant-metrics'

describe('resolveAttendantRequestSource', () => {
  it('marca offered_misunderstanding_rule pelo prefixo do PR #801', () => {
    expect(
      resolveAttendantRequestSource(
        undefined,
        `${MISUNDERSTANDING_ESC_CLIENT_PREFIX}msg_1`,
      ),
    ).toBe('offered_misunderstanding_rule')
    expect(resolveAttendantRequestSource(undefined, 'handoff.button:x')).toBe('spontaneous')
    expect(resolveAttendantRequestSource('spontaneous', 'ai-misunderstanding-esc:x')).toBe(
      'spontaneous',
    )
  })
})