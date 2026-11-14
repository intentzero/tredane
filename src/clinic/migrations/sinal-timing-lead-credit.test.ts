import { describe, expect, it } from 'vitest'
import { MIGRATION_ID, MIGRATION_NAME } from './0066_sinal_timing_lead_credit'

describe('0066_sinal_timing_lead_credit', () => {
  it('tem id e nome estáveis', () => {
    expect(MIGRATION_ID).toBe(66)
    expect(MIGRATION_NAME).toBe('0066_sinal_timing_lead_credit')
  })
})
