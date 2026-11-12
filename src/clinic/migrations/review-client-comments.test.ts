import { describe, expect, it } from 'vitest'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { MIGRATION_ID, MIGRATION_NAME } from './0062_review_client_comments'

describe('0062_review_client_comments', () => {
  it('id/nome e CLINIC_SCHEMA_VERSION alinhados', () => {
    expect(MIGRATION_ID).toBe(62)
    expect(MIGRATION_NAME).toBe('0062_review_client_comments')
    expect(CLINIC_SCHEMA_VERSION).toBe(63)
  })
})
