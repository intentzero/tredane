import { describe, expect, it } from 'vitest'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { MIGRATION_ID, MIGRATION_NAME } from './0056_booking_sessions'

describe('0056_booking_sessions', () => {
  it('id e nome da migração', () => {
    expect(MIGRATION_ID).toBe(57)
    expect(MIGRATION_NAME).toBe('0056_booking_sessions')
    expect(CLINIC_SCHEMA_VERSION).toBe(57)
  })
})
