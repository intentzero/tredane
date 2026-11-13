import { describe, expect, it } from 'vitest'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { CLINIC_MIGRATIONS } from '../migrations'
import { MIGRATION_ID, MIGRATION_NAME } from './0061_review_client_comment'

describe('0061_review_client_comment', () => {
  it('id e nome da migração no catálogo', () => {
    expect(MIGRATION_ID).toBe(61)
    expect(MIGRATION_NAME).toBe('0061_review_client_comment')
    expect(CLINIC_SCHEMA_VERSION).toBe(64)
    expect(
      CLINIC_MIGRATIONS.some((m) => m.id === 61 && m.name === MIGRATION_NAME),
    ).toBe(true)
  })
})
