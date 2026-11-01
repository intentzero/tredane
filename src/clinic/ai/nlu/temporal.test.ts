/**
 * Tabela #408 (CF-06–CF-11) + propriedades.
 * Âncora: qui 05/11/2026 (cenário da matriz).
 */
import { describe, expect, it } from 'vitest'
import { extractDates, extractTimes, parseTemporal } from './temporal'

const TODAY = '2026-11-05' // quinta

describe('parseTemporal (#408)', () => {
  const cases: Array<{
    id: string
    text: string
    today?: string
    dates?: string[]
    times?: string[]
    periods?: string[]
    relative?: string[]
    ambiguousAfternoonHour?: number | null
    dateConflict?: boolean
    invalidDateMention?: boolean
  }> = [
    {
      id: 'B-01',
      text: 'Limpeza de pele sábado dia 7 às 10h',
      dates: ['2026-11-07'],
      times: ['10:00'],
    },
    {
      id: 'B-02',
      text: 'Limpeza dia 5 de dezembro às 10h',
      dates: ['2026-12-05'],
      times: ['10:00'],
    },
    {
      id: 'B-03',
      text: 'Limpeza próxima quinta às 15h',
      dates: ['2026-11-12'],
      times: ['15:00'],
      relative: ['proxima_quinta'],
    },
    {
      id: 'B-04',
      text: 'Quero massagem semana que vem de manhã',
      dates: ['2026-11-09'],
      periods: ['manha'],
      relative: ['semana_que_vem'],
      times: [],
    },
    {
      id: 'B-06',
      text: 'Massagem amanhã 3 da tarde',
      dates: ['2026-11-06'],
      times: ['15:00'],
      periods: ['tarde'],
    },
    {
      id: 'B-07',
      text: 'Limpeza amanhã 15 e 30',
      dates: ['2026-11-06'],
      times: ['15:30'],
    },
    {
      id: 'B-08',
      text: 'Limpeza 31/11 às 10h',
      dates: [],
      times: ['10:00'],
      invalidDateMention: true,
    },
    {
      id: 'A-10',
      text: 'Limpeza de pele sexta ao meio-dia',
      dates: ['2026-11-06'],
      times: ['12:00'],
    },
    {
      id: 'C-03',
      text: 'custa 1500?',
      dates: [],
      times: [],
    },
    {
      id: 'C-12',
      text: 'a sessão dura 1h?',
      dates: [],
      times: [],
    },
    {
      id: 'CF-09-pelas',
      text: 'pode ser lá pelas 15',
      times: ['15:00'],
    },
    {
      id: 'B-05-ambig',
      text: 'Massagem amanhã às 3',
      dates: ['2026-11-06'],
      times: [],
      ambiguousAfternoonHour: 3,
    },
    {
      id: 'legacy-1530',
      text: '1530',
      times: ['15:30'],
    },
    {
      id: 'legacy-as-13',
      text: 'Hoje as 13',
      dates: ['2026-11-05'],
      times: ['13:00'],
    },
    {
      id: 'legacy-as-3-tarde',
      text: 'Pode ser às 3 da tarde',
      times: ['15:00'],
      periods: ['tarde'],
    },
    {
      id: 'weekday-date-conflict',
      text: 'segunda dia 7 às 10h',
      dates: [],
      times: ['10:00'],
      dateConflict: true,
    },
  ]

  for (const c of cases) {
    it(c.id, () => {
      const parsed = parseTemporal(c.text, { civilDate: c.today ?? TODAY })
      if (c.dates) expect(parsed.dates).toEqual(c.dates)
      if (c.times) expect(parsed.times).toEqual(c.times)
      if (c.periods) expect(parsed.periods).toEqual(c.periods)
      if (c.relative) expect(parsed.relative).toEqual(c.relative)
      if (c.ambiguousAfternoonHour !== undefined) {
        expect(parsed.ambiguousAfternoonHour).toBe(c.ambiguousAfternoonHour)
      }
      if (c.dateConflict !== undefined) expect(parsed.dateConflict).toBe(c.dateConflict)
      if (c.invalidDateMention !== undefined) {
        expect(parsed.invalidDateMention).toBe(c.invalidDateMention)
      }
    })
  }

  it('propriedade: nenhuma hora fora de 00–23', () => {
    const samples = [
      'às 25h',
      '99:99',
      'custa 2500',
      'dura 2h',
      'meio-dia',
      '15 e 30',
      '3 da tarde',
      'lá pelas 18',
    ]
    for (const text of samples) {
      for (const t of parseTemporal(text, TODAY).times) {
        const [h, m] = t.split(':').map(Number)
        expect(h).toBeGreaterThanOrEqual(0)
        expect(h).toBeLessThanOrEqual(23)
        expect(m).toBeGreaterThanOrEqual(0)
        expect(m).toBeLessThanOrEqual(59)
      }
    }
  })

  it('propriedade: nenhuma data inválida no resultado', () => {
    const samples = ['31/11', '30/02/2026', 'dia 31 de novembro', '32/10', '00/01']
    for (const text of samples) {
      const parsed = parseTemporal(text, TODAY)
      for (const d of parsed.dates) {
        expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        const [y, mo, day] = d.split('-').map(Number)
        const probe = new Date(Date.UTC(y!, mo! - 1, day!))
        expect(probe.getUTCFullYear()).toBe(y)
        expect(probe.getUTCMonth()).toBe(mo! - 1)
        expect(probe.getUTCDate()).toBe(day)
      }
    }
  })

  it('extractDates/extractTimes wrappers', () => {
    expect(extractDates('sábado dia 7', TODAY)).toEqual(new Set(['2026-11-07']))
    expect(extractDates('31/11', TODAY)).toEqual(new Set())
    expect(extractTimes('custa 1500?')).toEqual(new Set())
    expect(extractTimes('15 e 30')).toEqual(new Set(['15:30']))
  })
})
