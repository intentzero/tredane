import { describe, expect, it } from 'vitest'
import { connectedByLabel, formatPhone, formatWhen } from './format'

describe('formatPhone', () => {
  it('formata fixo e celular do Brasil', () => {
    expect(formatPhone('+551115336242')).toBe('+55 11 1533-6242')
    expect(formatPhone('5511912345678')).toBe('+55 11 91234-5678')
  })

  it('devolve o original quando não é número do Brasil e traço quando falta', () => {
    expect(formatPhone('+14155550100')).toBe('+14155550100')
    expect(formatPhone(null)).toBe('—')
  })
})

describe('formatWhen', () => {
  const now = Date.UTC(2026, 9, 27, 18, 0)

  it('omite o ano no ano atual, no horário de Brasília', () => {
    expect(formatWhen(Date.UTC(2026, 9, 27, 15, 35), now)).toBe('27/10 às 12:35')
  })

  it('mostra o ano quando é de outro ano', () => {
    expect(formatWhen(Date.UTC(2025, 11, 30, 15, 35), now)).toBe('30/12/2025 às 12:35')
  })
})

describe('connectedByLabel', () => {
  it('não expõe IDs', () => {
    expect(connectedByLabel('user_abc', 'user_abc')).toBe('por você')
    expect(connectedByLabel('system:ops_manual_staging', 'user_abc')).toBe('pela equipe do Tredane')
    expect(connectedByLabel('user_outro', 'user_abc')).toBe('por um responsável da clínica')
    expect(connectedByLabel(null, 'user_abc')).toBe('por um responsável da clínica')
  })
})
