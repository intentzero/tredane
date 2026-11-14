import { describe, expect, it } from 'vitest'
import { isLabEnabled, labMaxTurnsDaily, resolveLabWaId } from './gate'

const ON = { ENVIRONMENT: 'staging', LAB_ENABLED: 'true', OAUTH_KV: {} as KVNamespace }

describe('gate do laboratório (DEC-186)', () => {
  it('só abre em staging, com a flag e com o OAuth MCP configurado', () => {
    expect(isLabEnabled(ON)).toBe(true)
    expect(isLabEnabled({ ...ON, ENVIRONMENT: 'production' })).toBe(false)
    expect(isLabEnabled({ ...ON, ENVIRONMENT: undefined })).toBe(false)
    expect(isLabEnabled({ ...ON, LAB_ENABLED: 'false' })).toBe(false)
    expect(isLabEnabled({ ...ON, LAB_ENABLED: undefined })).toBe(false)
    expect(isLabEnabled({ ...ON, OAUTH_KV: undefined })).toBe(false)
    expect(isLabEnabled(undefined)).toBe(false)
  })

  it('só aceita números fictícios 5500…', () => {
    expect(resolveLabWaId(undefined)).toBe('550000000001')
    expect(resolveLabWaId('550000000042')).toBe('550000000042')
    expect(resolveLabWaId('5511999990000')).toBeNull()
    expect(resolveLabWaId(12)).toBeNull()
  })

  it('teto diário com padrão e limites', () => {
    expect(labMaxTurnsDaily({})).toBe(400)
    expect(labMaxTurnsDaily({ LAB_MAX_TURNS_DAILY: '50' })).toBe(50)
    expect(labMaxTurnsDaily({ LAB_MAX_TURNS_DAILY: '999999' })).toBe(400)
    expect(labMaxTurnsDaily({ LAB_MAX_TURNS_DAILY: 'abc' })).toBe(400)
  })
})
