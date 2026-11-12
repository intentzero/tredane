import { describe, expect, it } from 'vitest'
import { MIGRATION_ID, MIGRATION_NAME } from './0063_booking_lead_minutes'

describe('0063_booking_lead_minutes', () => {
  it('catálogo', () => {
    expect(MIGRATION_ID).toBe(63)
    expect(MIGRATION_NAME).toBe('0063_booking_lead_minutes')
  })
})
