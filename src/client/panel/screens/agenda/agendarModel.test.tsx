import { describe, expect, it } from 'vitest'
import { formatDeadline, formatWaId, nearestAlternatives, originRoute, uniqueTimes, visibleDays } from './agendarModel'

const s = (startsAt: number, professionalId = 'p') => ({
  startsAt, endsAt: startsAt + 1, occupiesUntil: startsAt + 1, professionalId, professionalName: professionalId, roomResourceId: null, roomResourceName: null,
})

describe('agendarModel', () => {
  it('um botão por hora', () => {
    expect(uniqueTimes([s(2), s(1, 'a'), s(1, 'b')]).map((x) => x.startsAt)).toEqual([1, 2])
  })
  it('alternativas mais próximas do horário perdido', () => {
    expect(nearestAlternatives([s(10), s(20), s(40), s(25)], 22)).toEqual([20, 25])
  })
  it('janela de 5 dias contém o escolhido', () => {
    const all = Array.from({ length: 20 }, (_, i) => `d${i}`)
    expect(visibleDays(all, 'd2')).toEqual(['d0', 'd1', 'd2', 'd3', 'd4'])
    expect(visibleDays(all, 'd10')).toContain('d10')
    expect(visibleDays(all, 'd19')).toHaveLength(5)
  })
  it('formata telefone e prazo', () => {
    expect(formatWaId('5511987654321')).toBe('+55 11 98765-4321')
    expect(formatDeadline(7200)).toBe('2 h')
    expect(formatDeadline(1800)).toBe('30 min')
  })
  it('origem', () => {
    expect(originRoute('t', { opportunityId: 'o' })).toMatchObject({ area: 'acompanhamento', opportunityId: 'o' })
    expect(originRoute('t', {})).toMatchObject({ area: 'agenda', section: 'dia' })
  })
})
