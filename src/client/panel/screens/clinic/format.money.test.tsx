import { describe, expect, it } from 'vitest'
import {
  formatPriceAmount,
  formatPriceCents,
  maskPriceInput,
  parsePriceToCents,
} from './format'

describe('formatPriceAmount / maskPriceInput', () => {
  it('formata centavos sem o símbolo R$', () => {
    expect(formatPriceAmount(0)).toBe('0,00')
    expect(formatPriceAmount(50)).toBe('0,50')
    expect(formatPriceAmount(5_000)).toBe('50,00')
    expect(formatPriceAmount(12_000)).toBe('120,00')
    expect(formatPriceAmount(150_000)).toBe('1.500,00')
    expect(formatPriceAmount(null)).toBe('')
  })

  it('mantém formatPriceCents com R$ para listas', () => {
    expect(formatPriceCents(12_000)).toMatch(/R\$\s*120,00/)
  })

  it('máscara: dígitos viram centavos (BR)', () => {
    expect(maskPriceInput('')).toBe('')
    expect(maskPriceInput('abc')).toBe('')
    expect(maskPriceInput('1')).toBe('0,01')
    expect(maskPriceInput('12')).toBe('0,12')
    expect(maskPriceInput('120')).toBe('1,20')
    expect(maskPriceInput('12000')).toBe('120,00')
    expect(maskPriceInput('R$ 1.500,00')).toBe('1.500,00')
    expect(maskPriceInput('150000')).toBe('1.500,00')
  })

  it('parsePriceToCents aceita máscara e valor com R$', () => {
    expect(parsePriceToCents('120,00')).toBe(12_000)
    expect(parsePriceToCents('1.500,00')).toBe(150_000)
    expect(parsePriceToCents('R$ 50,00')).toBe(5_000)
    expect(parsePriceToCents('')).toBeNull()
  })

  it('máscara → parse fecha o ciclo em centavos', () => {
    expect(parsePriceToCents(maskPriceInput('12000'))).toBe(12_000)
    expect(parsePriceToCents(maskPriceInput('6500'))).toBe(6_500)
  })
})
