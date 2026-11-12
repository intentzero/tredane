import { describe, expect, it } from 'vitest'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { CLINIC_MIGRATIONS } from '../migrations'
import { MIGRATION_ID, MIGRATION_NAME } from './0060_conversation_review_flag'

describe('0060_conversation_review_flag', () => {
  it('id e nome da migração no catálogo', () => {
    expect(MIGRATION_ID).toBe(60)
    expect(MIGRATION_NAME).toBe('0060_conversation_review_flag')
    expect(CLINIC_SCHEMA_VERSION).toBe(61)
    expect(CLINIC_MIGRATIONS.some((m) => m.id === 60 && m.name === MIGRATION_NAME)).toBe(true)
  })
})
