import { describe, expect, it } from 'vitest'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { CLINIC_MIGRATIONS } from '../migrations'
import { MIGRATION_ID, MIGRATION_NAME } from './0058_human_help_hint'

describe('0058_human_help_hint', () => {
  it('regista migração 58 e sobe o schema', () => {
    expect(MIGRATION_ID).toBe(58)
    expect(MIGRATION_NAME).toBe('0058_human_help_hint')
    expect(CLINIC_SCHEMA_VERSION).toBe(58)
    expect(CLINIC_MIGRATIONS.some((m) => m.id === 58 && m.name === MIGRATION_NAME)).toBe(true)
  })
})
