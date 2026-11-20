import { describe, expect, it } from 'vitest'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { MIGRATION_ID, MIGRATION_NAME, STATEMENTS } from './0072_booking_session_quality'

describe('0072_booking_session_quality', () => {
  it('id/nome e CLINIC_SCHEMA_VERSION alinhados', () => {
    expect(MIGRATION_ID).toBe(72)
    expect(MIGRATION_NAME).toBe('0072_booking_session_quality')
    expect(CLINIC_SCHEMA_VERSION).toBe(79)
    expect(STATEMENTS.length).toBeGreaterThan(0)
  })
})