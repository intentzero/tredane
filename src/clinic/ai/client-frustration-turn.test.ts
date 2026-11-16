import { describe, expect, it } from 'vitest'
import { isClientNotAnsweredComplaint } from './client-frustration-turn'

describe('client-frustration-turn', () => {
  it('deteta queixa de não-resposta em pt-BR informal', () => {
    expect(isClientNotAnsweredComplaint('vc nao responde o q eu pergunto ne')).toBe(true)
    expect(isClientNotAnsweredComplaint('você não entende nada')).toBe(true)
  })

  it('não confunde com pedido explícito de humano', () => {
    expect(isClientNotAnsweredComplaint('affs esquece. tem como falar com alguem?')).toBe(false)
    expect(isClientNotAnsweredComplaint('quero falar com a equipe')).toBe(false)
  })
})