import { describe, expect, it } from 'vitest'
import { formatBookedWhenAt } from './format-booked-when'

describe('formatBookedWhenAt (DEC-174 / push)', () => {
  it('formata weekday DD/MM às HH:MM no fuso da clínica', () => {
    // sexta 30/10/2026 12:00 America/Sao_Paulo
    const startsAt = Date.UTC(2026, 9, 30, 15, 0, 0)
    expect(formatBookedWhenAt('America/Sao_Paulo', startsAt)).toBe(
      'sexta 30/10 às 12:00',
    )
  })

  it('não inclui ano nem hora de fim', () => {
    const startsAt = Date.UTC(2026, 10, 17, 13, 30, 0) // terça 17/11 10:30 BRT
    const label = formatBookedWhenAt('America/Sao_Paulo', startsAt)
    expect(label).toBe('terça 17/11 às 10:30')
    expect(label).not.toMatch(/2026/)
    expect(label).not.toMatch(/–|—/)
  })
})
