import { describe, expect, it } from 'vitest'
import { clientWebFirstName } from './first-name'

describe('clientWebFirstName', () => {
  it('devolve só o primeiro nome e limpa texto perigoso', () => {
    expect(clientWebFirstName('Marina Souza')).toBe('Marina')
    expect(clientWebFirstName('  <b>Ana</b> Lima ')).toBe('Ana')
    expect(clientWebFirstName('Jo\u0007ão')).toBe('Jo')
    expect(clientWebFirstName('A'.repeat(100))).toHaveLength(40)
  })
  it('não usa telefone nem vazio como nome', () => {
    expect(clientWebFirstName('+55 11 98765-4321')).toBeNull()
    expect(clientWebFirstName('11987654321')).toBeNull()
    expect(clientWebFirstName('')).toBeNull()
    expect(clientWebFirstName(null)).toBeNull()
  })
})
