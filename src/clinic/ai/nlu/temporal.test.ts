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
      id: 'baseline-meio-dia-meia',
      text: 'meio dia e meia ta bom sim',
      times: ['12:30'],
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
      id: 'dec137-das',
      text: 'o das 10',
      times: ['10:00'],
    },
    {
      id: 'dec137-hrs',
      text: 'Sexta 10hrs',
      times: ['10:00'],
    },
    {
      id: 'dec137-hs',
      text: '10hs',
      times: ['10:00'],
    },
    {
      id: 'dec137-meia',
      text: '9 e meia',
      times: ['09:30'],
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
    // Lab #8 / PR-D: «depois das Nh» → período; sem HH:MM pontual.
    {
      id: 'PR-D-depois-20h',
      text: 'tem horário depois das 20h?',
      periods: ['noite'],
      times: [],
    },
    {
      id: 'PR-D-depois-18h',
      text: 'só posso depois das 18h',
      periods: ['noite'],
      times: [],
    },
    {
      id: 'PR-D-depois-14h',
      text: 'pode ser depois das 14h',
      periods: ['tarde'],
      times: [],
    },
    {
      id: 'PR-D-depois-10h',
      text: 'depois das 10h',
      periods: ['manha'],
      times: [],
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

  it('«às N e meia» / «e NN» dá uma só hora, com o período dito (staging 14/11/2026)', () => {
    // Antes: «às 8 e meia» lia também «às 8» e devolvia 08:00 e 08:30 (ambíguo → descartado).
    const cases: Array<[string, string[]]> = [
      ['às 8 e meia da manhã na terça tem?', ['08:30']],
      ['as 8 e meia', ['08:30']],
      ['das 8 e meia', ['08:30']],
      ['o das 8 e meia', ['08:30']],
      ['tem às 10 e meia?', ['10:30']],
      ['às 9 e 15', ['09:15']],
      // O período dito conta (antes: «às 3 e meia da tarde» dava 03:30).
      ['às 3 e meia da tarde', ['15:30']],
      ['às 7 e meia da noite', ['19:30']],
      ['às 12 e meia da manhã', ['00:30']],
      // Período antes do relógio («à tarde às 3 e meia») — periods globais, não só trailing.
      ['à tarde às 3 e meia', ['15:30']],
      ['à noite às 7 e meia', ['19:30']],
      // Sem regressão: hora redonda e «N e NN» soltos.
      ['às 8', ['08:00']],
      ['15 e 30', ['15:30']],
      ['9 e meia', ['09:30']],
    ]
    for (const [text, expected] of cases) {
      expect(extractTimes(text), text).toEqual(new Set(expected))
    }
    // 1–7 sem período: ambíguo (não trava 03:30); igual a «às 3».
    const amb = parseTemporal('às 3 e meia', TODAY)
    expect(amb.times).toEqual([])
    expect(amb.ambiguousAfternoonHour).toBe(3)
  })

  it('extractDates/extractTimes wrappers', () => {
    expect(extractDates('sábado dia 7', TODAY)).toEqual(new Set(['2026-11-07']))
    expect(extractDates('31/11', TODAY)).toEqual(new Set())
    expect(extractTimes('custa 1500?')).toEqual(new Set())
    expect(extractTimes('15 e 30')).toEqual(new Set(['15:30']))
  })

  it('PR-D: «depois das Nh» não vira relógio pontual; «depois de amanhã» intacto', () => {
    expect(extractTimes('tem horário depois das 20h?')).toEqual(new Set())
    expect(extractTimes('depois das 18h')).toEqual(new Set())
    // Sem regressão: «das 14» / «às 20h» soltos continuam relógio.
    expect(extractTimes('o das 14')).toEqual(new Set(['14:00']))
    expect(extractTimes('às 20h')).toEqual(new Set(['20:00']))
    const amanha = parseTemporal('depois de amanhã de manhã', TODAY)
    expect(amanha.dates).toEqual(['2026-11-07'])
    expect(amanha.periods).toEqual(['manha'])
  })
})
