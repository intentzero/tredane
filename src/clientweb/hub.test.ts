import { describe, expect, it } from 'vitest'
import { hubOpeningBody, isMyAppointmentsQuery } from './hub'

describe('frases fixas do chat que não marcam (DEC-202)', () => {
  it('abertura com o expediente de hoje', () => {
    expect(hubOpeningBody('Clínica Aurora', { opensAt: '09:00', closesAt: '18:00' })).toBe(
      'Olá! Aqui é a Clínica Aurora. Hoje funcionamos das 09:00 às 18:00. O que você precisa?',
    )
    expect(hubOpeningBody(null, null)).toBe('Olá! Aqui é a clínica. O que você precisa?')
    expect(hubOpeningBody('Aurora', { opensAt: '09:00', closesAt: null })).toContain('a partir das 09:00')
  })

  it('«meus agendamentos» / «quero ver» é consulta; remarcar, cancelar e «outro agendamento» não são', () => {
    expect(isMyAppointmentsQuery('quais são os meus agendamentos?')).toBe(true)
    expect(isMyAppointmentsQuery('Quero ver os meus agendamentos')).toBe(true)
    expect(isMyAppointmentsQuery('já tenho alguma marcação?')).toBe(true)
    expect(isMyAppointmentsQuery('quero remarcar meu agendamento')).toBe(false)
    expect(isMyAppointmentsQuery('quero cancelar meus agendamentos')).toBe(false)
    expect(isMyAppointmentsQuery('quero outro agendamento')).toBe(false)
  })
})
