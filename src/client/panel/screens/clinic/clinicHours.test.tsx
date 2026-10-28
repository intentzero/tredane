import { describe, expect, it } from 'vitest'
import { blockRange, countDays, describeWeek, formatPeriod, fromWeekDraft, toWeekDraft } from './clinicHours'

const TZ = 'America/Sao_Paulo'
const w = (dayOfWeek: number, startMinute: number, endMinute: number) => ({
  id: `${dayOfWeek}-${startMinute}`, resourceId: 'r', dayOfWeek, startMinute, endMinute,
})

describe('horário da clínica', () => {
  it('descreve a semana agrupando dias iguais', () => {
    const draft = toWeekDraft([1, 2, 3, 4, 5].map((d) => w(d, 480, 1080)).concat([w(6, 480, 780)]))
    expect(describeWeek(draft)).toBe('Seg–sex 08:00–18:00 · sáb 08:00–13:00')
    expect(describeWeek(toWeekDraft([]))).toBe('Sem horário')
  })

  it('rascunho ida e volta preserva faixas e ordem', () => {
    const rows = [w(1, 780, 1080), w(1, 480, 720), w(3, 540, 600)]
    const back = fromWeekDraft(toWeekDraft(rows))
    expect(back).toEqual([
      { dayOfWeek: 1, startMinute: 480, endMinute: 720 },
      { dayOfWeek: 1, startMinute: 780, endMinute: 1080 },
      { dayOfWeek: 3, startMinute: 540, endMinute: 600 },
    ])
  })

  it('período «de … até» no fuso da clínica (dia inteiro cobre as duas pontas)', () => {
    const r = blockRange('2026-11-10', '2026-11-20', true, 0, 0, TZ)!
    expect(formatPeriod(r.startsAt, r.endsAt, TZ)).toBe('10/11 – 20/11')
    expect(countDays(r.startsAt, r.endsAt, TZ)).toBe(11)
    const one = blockRange('2026-11-15', '2026-11-15', true, 0, 0, TZ)!
    expect(formatPeriod(one.startsAt, one.endsAt, TZ)).toBe('15/11')
    expect(blockRange('2026-11-20', '2026-11-10', true, 0, 0, TZ)).toBeNull()
    expect(blockRange('2026-11-10', '2026-11-10', false, 600, 540, TZ)).toBeNull()
  })
})
