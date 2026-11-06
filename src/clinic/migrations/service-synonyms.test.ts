import { describe, expect, it } from 'vitest'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { CLINIC_MIGRATIONS } from '../migrations'

describe('migração 0050_service_synonyms', () => {
  it('regista id 50 e sobe o alvo do schema', () => {
    expect(CLINIC_SCHEMA_VERSION).toBe(54)
    const m = CLINIC_MIGRATIONS.find((x) => x.id === 50)
    expect(m?.name).toBe('0050_service_synonyms')
    expect(m?.statements.some((s) => s.includes('services') && s.includes('synonyms_json'))).toBe(
      true,
    )
    expect(
      m?.statements.some((s) => s.includes('service_zones') && s.includes('synonyms_json')),
    ).toBe(true)
  })
})
