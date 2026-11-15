import { describe, expect, it } from 'vitest'
import { MIGRATION_ID, MIGRATION_NAME, STATEMENTS } from './0070_zone_explanation_audience'

describe('0070_zone_explanation_audience', () => {
  it('regista id 70 e move o texto legado para o override', () => {
    expect(MIGRATION_ID).toBe(70)
    expect(MIGRATION_NAME).toBe('0070_zone_explanation_audience')
    expect(STATEMENTS[0]).toMatch(/client_explanation_audience/)
    expect(STATEMENTS.some((s) => /SET client_explanation_audience = trim\(client_explanation\)/i.test(s))).toBe(
      true,
    )
    expect(STATEMENTS.some((s) => /SET client_explanation = NULL/i.test(s))).toBe(true)
  })
})
