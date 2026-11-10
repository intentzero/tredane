import { describe, expect, it } from 'vitest'
import { MIGRATION_ID, MIGRATION_NAME } from './0059_handoff_timeout'
import { CLINIC_SCHEMA_VERSION } from '../constants'

describe('0059_handoff_timeout', () => {
  it('id e nome estáveis', () => {
    expect(MIGRATION_ID).toBe(59)
    expect(MIGRATION_NAME).toBe('0059_handoff_timeout')
    expect(CLINIC_SCHEMA_VERSION).toBe(59)
  })
})
