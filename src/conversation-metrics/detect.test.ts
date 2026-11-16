import { describe, expect, it } from 'vitest'
import { detectFalseConfirmationSignals, outboundLooksLikeMisunderstanding } from './detect'

describe('detectFalseConfirmationSignals', () => {
  it('team_will_confirm quando promete equipe', () => {
    const s = detectFalseConfirmationSignals(
      'Sua solicitação já está com a equipe; a equipe confirma e já te retorna.',
    )
    expect(s).toContain('team_will_confirm')
  })

  it('claimed_booked em Agendado:', () => {
    const s = detectFalseConfirmationSignals('Agendado: Limpeza · quinta às 15:15.')
    expect(s).toContain('claimed_booked')
  })

  it('ignora lacuna DEC-090 valor', () => {
    const s = detectFalseConfirmationSignals('A equipe confirma o valor.')
    expect(s).not.toContain('team_will_confirm')
  })
})

describe('outboundLooksLikeMisunderstanding', () => {
  it('deteta Não entendi / Não consegui entender', () => {
    expect(outboundLooksLikeMisunderstanding('Não consegui entender bem. Pode reformular?')).toBe(
      true,
    )
    expect(outboundLooksLikeMisunderstanding('Não entendi bem esse pedido.')).toBe(true)
    expect(outboundLooksLikeMisunderstanding('Horários: 12:30, 13:00')).toBe(false)
  })
})