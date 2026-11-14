import { describe, expect, it } from 'vitest'
import { MIGRATION_ID, MIGRATION_NAME } from './0068_clinic_knowledge'

describe('0068_clinic_knowledge', () => {
  it('tem id e nome estáveis', () => {
    expect(MIGRATION_ID).toBe(68)
    expect(MIGRATION_NAME).toBe('0068_clinic_knowledge')
  })
})
