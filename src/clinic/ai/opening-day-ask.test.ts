import { describe, expect, it } from 'vitest'
import { isOpeningDayAsk } from './opening-day-ask'

describe('opening-day-ask', () => {
  it('reconhece «atende no domingo» com typo', () => {
    expect(isOpeningDayAsk('Gostaria saber se você atende j no o domingo?')).toBe(true)
  })
  it('reconhece «domingo vocês atendem»', () => {
    expect(isOpeningDayAsk('no domingo vocês atendem?')).toBe(true)
  })
  it('não confunde marcação com horário', () => {
    expect(isOpeningDayAsk('quero agendar depilação segunda às 15h')).toBe(false)
  })
})