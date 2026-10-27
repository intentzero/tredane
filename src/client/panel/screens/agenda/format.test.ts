import { describe, expect, it } from 'vitest'
import { formatDateRange, formatLongDate } from './format'

describe('formatLongDate', () => {
  it('escreve a data por extenso, sem «-feira» e com maiúscula', () => {
    expect(formatLongDate('2026-10-27', 'America/Sao_Paulo')).toBe('Terça, 27 de outubro')
  })

  it('mantém sábado e domingo', () => {
    expect(formatLongDate('2026-10-31', 'America/Sao_Paulo')).toBe('Sábado, 31 de outubro')
    expect(formatLongDate('2026-11-01', 'America/Sao_Paulo')).toBe('Domingo, 1 de novembro')
  })
})

describe('formatDateRange', () => {
  it('mostra o intervalo da semana entre meses', () => {
    expect(formatDateRange('2026-10-26', '2026-11-01', 'America/Sao_Paulo')).toBe(
      '26 de outubro – 1 de novembro',
    )
  })
})
