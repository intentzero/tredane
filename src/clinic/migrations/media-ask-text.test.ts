import { describe, expect, it } from 'vitest'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { CLINIC_MIGRATIONS } from '../migrations'

describe('migração 0051_media_ask_text', () => {
  it('regista id 51 e sobe o alvo do schema', () => {
    expect(CLINIC_SCHEMA_VERSION).toBe(51)
    const m = CLINIC_MIGRATIONS.find((x) => x.id === 51)
    expect(m?.name).toBe('0051_media_ask_text')
    expect(m?.statements.some((s) => s.includes('media_ask_text_at'))).toBe(true)
  })
})
