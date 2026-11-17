import { describe, expect, it } from 'vitest'
import { MIGRATION_ID, MIGRATION_NAME } from './0065_idle_suppressed'
import { CLINIC_SCHEMA_VERSION } from '../constants'

describe('0065_idle_suppressed', () => {
  it('id e nome estáveis', () => {
    expect(MIGRATION_ID).toBe(65)
    expect(MIGRATION_NAME).toBe('0065_idle_suppressed')
    expect(CLINIC_SCHEMA_VERSION).toBe(73)
  })
})
