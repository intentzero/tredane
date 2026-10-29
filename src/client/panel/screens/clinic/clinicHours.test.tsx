import { describe, expect, it } from 'vitest'
import {
  blockRange,
  changedDays,
  countDays,
  describeWeek,
  formatPeriod,
  fromWeekDraft,
  normalizeScopes,
  openNow,
  personColor,
  personMark,
  toWeekDraft,
  validateDay,
} from './clinicHours'

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

describe('regras do horário (#223)', () => {
  it('«Clínica inteira» é exclusiva em «Quem fica fora»', () => {
    expect(normalizeScopes(['p1'], ['p1', '__clinic__'])).toEqual(['__clinic__'])
    expect(normalizeScopes(['__clinic__'], ['__clinic__', 'p1'])).toEqual(['p1'])
    expect(normalizeScopes(['p1'], ['p1', 'p2'])).toEqual(['p1', 'p2'])
  })

  it('recusa faixas com fim antes do início ou sobrepostas', () => {
    expect(validateDay([{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1080 }])).toBeNull()
    expect(validateDay([{ startMinute: 600, endMinute: 540 }])).toMatch(/depois do início/)
    expect(validateDay([{ startMinute: 480, endMinute: 720 }, { startMinute: 700, endMinute: 900 }])).toMatch(/sobrepor/)
  })

  it('diz quais dias mudaram e se está aberta agora no fuso da clínica', () => {
    const a = { 1: [{ startMinute: 480, endMinute: 1080 }] }
    expect(changedDays(a, { ...a, 2: [{ startMinute: 480, endMinute: 1080 }] })).toEqual([2])
    // Segunda, 2026-11-02 14:00 em Brasília (17:00 UTC).
    const ms = Date.UTC(2026, 10, 2, 17, 0)
    expect(openNow(a, ms, 'America/Sao_Paulo')).toEqual({ open: true, closesAt: 1080 })
    expect(openNow(a, Date.UTC(2026, 10, 2, 23, 0), 'America/Sao_Paulo')).toEqual({ open: false })
  })

  it('da 4.ª pessoa em diante usa cinza com iniciais (#223)', () => {
    expect([0, 1, 2].map(personColor)).toEqual(['#2563A8', '#C2410C', '#2F7D4F'])
    expect(personColor(3)).toBe(personColor(7))
    expect(personColor(3)).not.toBe(personColor(0))
    expect(personMark(2, 'Lívia')).toBeUndefined()
    expect(personMark(3, 'Ana Souza')).toBe('AS')
    expect(personMark(4, 'beatriz')).toBe('B')
  })
})
