import { describe, expect, it } from 'vitest'
import { isOpeningDayAsk } from './opening-day-ask'

describe('opening-day-ask', () => {
  it('reconhece «atende no domingo» com typo', () => {
    expect(isOpeningDayAsk('Gostaria saber se você atende j no o domingo?')).toBe(true)
  })
  it('reconhece «domingo vocês atendem»', () => {
    expect(isOpeningDayAsk('no domingo vocês atendem?')).toBe(true)
  })
  it('reconhece «Vocês abrem amanhã?» (FAQ de expediente, não marcação)', () => {
    expect(isOpeningDayAsk('Vocês abrem amanhã?')).toBe(true)
    expect(isOpeningDayAsk('abrem amanha')).toBe(true)
    expect(isOpeningDayAsk('vocês atendem hoje?')).toBe(true)
    expect(isOpeningDayAsk('funciona depois de amanhã?')).toBe(true)
    // TRE-77: infinitivo («pode me atender amanhã?»).
    expect(isOpeningDayAsk('Você pode-me atender amanhã?')).toBe(true)
    expect(isOpeningDayAsk('Você pode me atender amanhã?')).toBe(true)
  })
  it('reconhece gerúndio e «aberto» («está atendendo hoje?»)', () => {
    expect(isOpeningDayAsk('está atendendo hoje?')).toBe(true)
    expect(
      isOpeningDayAsk('Bom dia. Gostaria de saber se está atendendo hoje?'),
    ).toBe(true)
    expect(isOpeningDayAsk('estão abertos amanhã?')).toBe(true)
    expect(isOpeningDayAsk('está funcionando hoje?')).toBe(true)
  })
  it('não confunde marcação com horário', () => {
    expect(isOpeningDayAsk('quero agendar depilação segunda às 15h')).toBe(false)
  })
})
