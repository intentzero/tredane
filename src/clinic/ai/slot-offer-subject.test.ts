/** O aviso «sem horário no período» não repete o assunto ao juntar-se à oferta. */
import { describe, expect, it } from 'vitest'
import { dropRepeatedSubject } from './slot-offer'

describe('dropRepeatedSubject', () => {
  it('tira «Para {assunto}, » e põe maiúscula', () => {
    expect(dropRepeatedSubject('Para massagem, tenho hoje às 10:45. Qual fica melhor?', 'massagem')).toBe(
      'Tenho hoje às 10:45. Qual fica melhor?',
    )
  })
  it('não mexe em frases sem esse prefixo', () => {
    const t = 'Os próximos horários para massagem são hoje às 10:45. Algum serve?'
    expect(dropRepeatedSubject(t, 'massagem')).toBe(t)
  })
  it('não mexe se o assunto for outro', () => {
    const t = 'Para depilação, tenho hoje às 10:45.'
    expect(dropRepeatedSubject(t, 'massagem')).toBe(t)
  })
})
