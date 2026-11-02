import { afterEach, describe, expect, it } from 'vitest'
import {
  DIALOGUE_ACTS,
  renderEveryVariant,
  setDialogueVariantForTests,
} from './dialogue-acts'
import {
  dayWithPrepPt,
  periodFromHHMM,
  pickNearbySameDay,
  minutesOfHHMM,
  periodWordPt,
} from './slot-offer'
import { sayAct } from './dialogue-acts'

afterEach(() => {
  setDialogueVariantForTests(null)
})

describe('slot-offer (#413 CF-15 / CF-19 / #448)', () => {
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

  it('dayWithPrepPt leva a preposição e hoje/amanhã', () => {
    expect(dayWithPrepPt('2026-11-06')).toBe('na sexta (06/11)')
    expect(dayWithPrepPt('2026-11-07')).toBe('no sábado (07/11)')
    expect(dayWithPrepPt('2026-11-06', '2026-11-06')).toBe('hoje')
    expect(dayWithPrepPt('2026-11-07', '2026-11-06')).toBe('amanhã')
  })

  it('cada variante forçada dos atos do slot-offer passa o validador', () => {
    const cases: Array<[keyof typeof DIALOGUE_ACTS, Record<string, string>]> = [
      ['oferecer_horarios', { assunto: 'Massagem', quando: 'de manhã ', lista: 'sexta 06/11 às 09:00, 10:00' }],
      ['oferecer_horarios', { assunto: 'Massagem', quando: '', lista: 'sexta 06/11 às 09:00' }],
      ['sem_horario_periodo', { assunto: 'Massagem', período: periodWordPt('manha') }],
      ['sem_horario_dia', { assunto: 'Massagem', dia: dayWithPrepPt('2026-11-06') }],
      ['sem_horario_semana', { assunto: 'Massagem' }],
      ['sem_vaga_alternativas', { hora: '16:00', lista: '15:00, 14:30' }],
      ['sem_vaga_sem_alternativa', { hora: '16:00' }],
    ]
    for (const [act, vars] of cases) {
      const all = renderEveryVariant(act, vars)
      expect(all.length, act).toBeGreaterThan(0)
      for (let i = 0; i < all.length; i++) {
        setDialogueVariantForTests(i)
        const text = sayAct(act, 'cnv_slot_offer', vars, 'FALLBACK')
        expect(text, `${act}#${i}`).toBe(all[i])
        expect(text).not.toBe('FALLBACK')
      }
    }
  })
})
