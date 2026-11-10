import { describe, expect, it } from 'vitest'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { CLINIC_MIGRATIONS } from '../migrations'
import { MIGRATION_ID, MIGRATION_NAME } from './0057_end_help_hint'

describe('0057_end_help_hint', () => {
  it('regista migração 57 e sobe o schema', () => {
    expect(MIGRATION_ID).toBe(57)
    expect(MIGRATION_NAME).toBe('0057_end_help_hint')
    expect(CLINIC_SCHEMA_VERSION).toBe(59)
    expect(CLINIC_MIGRATIONS.some((m) => m.id === 57 && m.name === MIGRATION_NAME)).toBe(true)
  })
})
