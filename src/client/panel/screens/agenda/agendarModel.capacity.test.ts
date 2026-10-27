import { describe, expect, it } from 'vitest'
import { defaultConfirmationMessage } from './agendarModel'

describe('confirmação com frase fixa da sala (DEC-053 + capacidade)', () => {
  it('inclui a frase da sala e não muda a mensagem sem frase', () => {
    const base = { contactName: 'Ana Souza', serviceName: 'Bronzeamento', professionalName: 'Bia', whenLabel: 'seg, 08/01, às 09:00' }
    expect(defaultConfirmationMessage(base)).not.toContain('compartilhado')
    expect(defaultConfirmationMessage({ ...base, roomSharedNotice: 'O espaço é compartilhado.' })).toContain(
      'confirmado para seg, 08/01, às 09:00. O espaço é compartilhado. Qualquer coisa',
    )
  })
})
