/** DEC-181: o cue «fim de …» pede os últimos horários; o resto fica como sempre. */
import { describe, expect, it } from 'vitest'
import { slotOrderFromText } from './slot-offer'

describe('slotOrderFromText (DEC-181)', () => {
  it.each([
    'Quero massagem sexta no fim da tarde',
    'no final da manhã',
    'finalzinho da tarde de sábado',
    'finzinho do dia',
    'FIM DA TARDE',
    'fim de tarde no sábado',
  ])('«%s» pede os últimos horários', (text) => {
    expect(slotOrderFromText(text)).toBe('latest')
  })

  it.each([
    'Quero massagem sexta à tarde',
    'no início da manhã',
    'de manhãzinha',
    'depois do almoço',
    'quero o fim de semana',
    'o final do mês',
    'sexta',
    '',
  ])('«%s» mantém a ordem normal', (text) => {
    expect(slotOrderFromText(text)).toBe('earliest')
  })
})
