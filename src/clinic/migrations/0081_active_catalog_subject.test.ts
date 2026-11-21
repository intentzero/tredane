import { describe, expect, it } from 'vitest'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { MIGRATION_ID, MIGRATION_NAME } from './0081_active_catalog_subject'

describe('0081_active_catalog_subject', () => {
  it('migração 81 sobe CLINIC_SCHEMA_VERSION', () => {
    expect(MIGRATION_ID).toBe(81)
    expect(MIGRATION_NAME).toBe('0081_active_catalog_subject')
    expect(CLINIC_SCHEMA_VERSION).toBe(81)
  })
})
