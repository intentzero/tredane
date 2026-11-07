import { describe, expect, it } from 'vitest'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { bootClinicDb } from '../test-db'
import { MIGRATION_ID, MIGRATION_NAME } from './0055_variant_selection'

describe('0055_variant_selection', () => {
  it('sobe o schema e cria variant_selection com default varias', () => {
    expect(MIGRATION_ID).toBe(55)
    expect(MIGRATION_NAME).toBe('0055_variant_selection')
    expect(CLINIC_SCHEMA_VERSION).toBe(56)
    const boot = bootClinicDb()
    try {
      const col = boot.db.get<{ name: string; dflt_value: string | null }>(
        `SELECT name, dflt_value FROM pragma_table_info('services') WHERE name = 'variant_selection'`,
      )
      expect(col?.name).toBe('variant_selection')
      expect(col?.dflt_value).toMatch(/varias/)
    } finally {
      boot.close()
    }
  })
})
