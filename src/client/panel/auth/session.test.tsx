import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPickingClinic,
  isPickingClinic,
  markPickingClinic,
  readLastTenantId,
  writeLastTenantId,
} from './session'

describe('última clínica do aparelho', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('guarda e apaga o identificador', () => {
    expect(readLastTenantId()).toBeNull()
    writeLastTenantId('clinic-demo-a')
    expect(readLastTenantId()).toBe('clinic-demo-a')
    writeLastTenantId(null)
    expect(readLastTenantId()).toBeNull()
  })

  it('«Trocar clínica» marca a escolha e a limpeza desmarca', () => {
    expect(isPickingClinic()).toBe(false)
    markPickingClinic()
    expect(isPickingClinic()).toBe(true)
    clearPickingClinic()
    expect(isPickingClinic()).toBe(false)
  })
})
