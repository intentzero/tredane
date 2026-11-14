import { describe, expect, it } from 'vitest'
import { MIGRATION_ID, MIGRATION_NAME, STATEMENTS } from './0067_zone_client_explanation'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { CLINIC_MIGRATIONS } from '../migrations'

describe('0067_zone_client_explanation', () => {
  it('id, nome e alvo do schema', () => {
    expect(MIGRATION_ID).toBe(67)
    expect(MIGRATION_NAME).toBe('0067_zone_client_explanation')
    expect(CLINIC_SCHEMA_VERSION).toBe(67)
    const m = CLINIC_MIGRATIONS.find((x) => x.id === 67)
    expect(m?.name).toBe(MIGRATION_NAME)
    expect(STATEMENTS.some((s) => s.includes('service_zones') && s.includes('client_explanation'))).toBe(
      true,
    )
  })
})
