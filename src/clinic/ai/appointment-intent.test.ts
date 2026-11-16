import { describe, expect, it } from 'vitest'
import { pickUpcomingByCitedClock } from './appointment-intent'
import type { UpcomingApt } from './reschedule'
import { zonedCivilToUtc } from '../scheduling'

const TZ = 'America/Sao_Paulo'

function apt(
  id: string,
  serviceId: string,
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
): UpcomingApt {
  const startsAt = zonedCivilToUtc(TZ, y, mo, d, h, mi)
  return {
    id,
    serviceId,
    professionalId: 'pro',
    startsAt,
    endsAt: startsAt + 30 * 60_000,
    serviceName: 'Depilação',
  }
}

describe('pickUpcomingByCitedClock', () => {
  it('desambigua duas depilações no mesmo dia por 1645 / 16h45 / 16:45', () => {
    const pool = [
      apt('a13', 'dep', 2026, 11, 16, 13, 0),
      apt('a1645', 'dep', 2026, 11, 16, 16, 45),
    ]
    for (const text of [
      'Quero remarcar a depilação de hoje às 1645',
      'depilação de hoje 16h45',
      'às 16:45 hoje',
    ]) {
      const picked = pickUpcomingByCitedClock(pool, text, TZ)
      expect(picked?.id, text).toBe('a1645')
    }
  })
})