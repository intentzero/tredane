import { describe, expect, it } from 'vitest'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { MIGRATION_ID, MIGRATION_NAME } from './0069_llm_jobs'

describe('0069_llm_jobs', () => {
  it('id/nome e CLINIC_SCHEMA_VERSION alinhados', () => {
    expect(MIGRATION_ID).toBe(69)
    expect(MIGRATION_NAME).toBe('0069_llm_jobs')
    expect(CLINIC_SCHEMA_VERSION).toBe(75)
  })
})
