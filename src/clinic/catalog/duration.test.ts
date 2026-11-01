/**
 * #435 (CF-24): hora do relógio não é duração. Dados fictícios.
 */
import { describe, expect, it } from 'vitest'
import { durationMinutesFromText } from './duration'

describe('durationMinutesFromText', () => {
  it.each([
    ['meia hora', 30],
    ['30 min', 30],
    ['90 min', 90],
    ['60 minutos', 60],
    ['2h', 120],
    ['duas horas', 120],
    ['o de uma hora', 60],
    ['uma sessão de 1 hora', 60],
    ['com 1h de duração', 60],
    ['uma hora e meia', 90],
    ['45 min', 45],
    ['3h', 180],
  ])('«%s» → %i min', (text, minutes) => {
    expect(durationMinutesFromText(text)).toBe(minutes)
  })

  it.each([
    'Quero depilação feminina de axila sexta às 10h',
    'quero axila sexta às 10h',
    'sexta 16h',
    'amanhã às 15h',
    'pode ser 15h30',
    'às 10',
    'das 9h às 11h',
    'até as 18h',
    'às 10:00',
    'Quero marcar uma hora para amanhã',
    'tem uma hora livre amanhã?',
    'sábado 7/11 às 9h',
  ])('hora do relógio ou «uma hora» de consulta não é duração: «%s»', (text) => {
    expect(durationMinutesFromText(text)).toBeNull()
  })

  it('«às 30 min» continua a ser duração, não relógio', () => {
    expect(durationMinutesFromText('axila de 30 min às 10h')).toBe(30)
  })
})
