import { describe, expect, it } from 'vitest'
import { OPS_ALERT_KINDS, severityForAlert } from '../ops/alerts'

describe('conversation.false_confirmation alert', () => {
  it('está no catálogo ops como critical/error', () => {
    expect(OPS_ALERT_KINDS).toContain('conversation.false_confirmation')
    expect(severityForAlert('conversation.false_confirmation')).toBe('critical')
  })
})