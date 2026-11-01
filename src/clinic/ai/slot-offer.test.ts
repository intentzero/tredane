import { describe, expect, it } from 'vitest'
import {
  periodFromHHMM,
  pickNearbySameDay,
  minutesOfHHMM,
} from './slot-offer'

describe('slot-offer (#413 CF-15 / CF-19)', () => {
  it('periodFromHHMM classifica manhã/tarde/noite', () => {
    expect(periodFromHHMM('09:00')).toBe('manha')
    expect(periodFromHHMM('16:00')).toBe('tarde')
    expect(periodFromHHMM('19:30')).toBe('noite')
  })

  it('pickNearbySameDay ordena por proximidade e fica no período da tarde', () => {
    const tz = 'America/Sao_Paulo'
    // Sexta 06/11/2026: slots fictícios em epoch (UTC = SP+3 no horário de verão? Nov=−3).
    // 09:00 SP = 12:00 UTC; 14:00 SP = 17:00 UTC; 15:00 = 18:00 UTC; 15:30 = 18:30 UTC.
    const day = Date.UTC(2026, 10, 6)
    const slots = [
      { startsAt: day + 12 * 3600_000 }, // 09:00 SP
      { startsAt: day + 13 * 3600_000 }, // 10:00
      { startsAt: day + 14 * 3600_000 }, // 11:00
      { startsAt: day + 17 * 3600_000 }, // 14:00
      { startsAt: day + 18 * 3600_000 }, // 15:00
      { startsAt: day + 18.5 * 3600_000 }, // 15:30
    ]
    const nearby = pickNearbySameDay(slots, '16:00', tz, { period: 'tarde', limit: 3 })
    expect(nearby).toEqual(['15:30', '15:00', '14:00'])
    expect(nearby.every((t) => minutesOfHHMM(t) >= 12 * 60)).toBe(true)
    expect(nearby).not.toContain('09:00')
  })

  it('pickNearbySameDay exclui a hora pedida', () => {
    const tz = 'America/Sao_Paulo'
    const day = Date.UTC(2026, 10, 6)
    const slots = [
      { startsAt: day + 17 * 3600_000 },
      { startsAt: day + 18 * 3600_000 },
      { startsAt: day + 19 * 3600_000 }, // 16:00 SP
    ]
    expect(pickNearbySameDay(slots, '16:00', tz)).not.toContain('16:00')
  })
})
