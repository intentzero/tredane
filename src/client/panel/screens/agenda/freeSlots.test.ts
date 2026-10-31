import { describe, expect, it } from 'vitest'
import type { AgendaProfessionalAvailability } from '../../api'
import { freeSlotsOfDay, occupancyOfDay } from './freeSlots'

const av: AgendaProfessionalAvailability[] = [
  {
    professionalId: 'p1',
    professionalName: 'Gi',
    days: [{ date: '2026-11-09', openMinutes: 480, busyMinutes: 120, windows: [], free: [{ startsAt: 200, endsAt: 300 }, { startsAt: 100, endsAt: 150 }], blocks: [] }],
  },
  {
    professionalId: 'p2',
    professionalName: 'Ana',
    days: [{ date: '2026-11-09', openMinutes: 0, busyMinutes: 0, windows: [], free: [], blocks: [] }],
  },
]

describe('freeSlots', () => {
  it('ordena por hora e respeita o filtro por profissional', () => {
    expect(freeSlotsOfDay(av, '2026-11-09').map((s) => s.startsAt)).toEqual([100, 200])
    expect(freeSlotsOfDay(av, '2026-11-09', ['p2'])).toEqual([])
    expect(freeSlotsOfDay(undefined, '2026-11-09')).toEqual([])
  })
  it('ocupação ignora expediente fechado', () => {
    expect(occupancyOfDay(av, '2026-11-09')).toEqual([
      { professionalId: 'p1', professionalName: 'Gi', openMinutes: 480, busyMinutes: 120, percent: 25 },
    ])
  })
})
