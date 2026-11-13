/**
 * rsamp_fa7f138 (13/11/2026): pedido explícito de atendente em texto livre (DEC-083).
 * Positivos casam com e sem acento/caixa; «pessoa» fora de contexto de pedido não casa.
 */
import { describe, expect, it } from 'vitest'
import { classifySensitive, wantsHumanPause, wantsHumanText } from './sensitive'

const POSITIVE = [
  'Posso falar com um atendente?',
  'posso falar com um atendente',
  'Quero falar com um atendente',
  'QUERO FALAR COM UM ATENDENTE',
  'quero falar com uma pessoa',
  'Falar com alguém',
  'falar com alguem',
  'Quero falar com alguém da equipe',
  'falar com a equipe',
  'me passa pra alguém',
  'Me passa pra alguem por favor',
  'me passa para um atendente',
  'Me transfere para um humano',
  'chama um atendente',
  'Posso conversar com uma pessoa?',
  'quero um atendente',
  'preciso de um humano',
  'Atendente',
  'um atendente?',
  'Humano',
  'HUMANO!',
  'humano?',
  'pessoa real',
  'quero atendimento humano',
  'quero uma pessoa',
  'Oi, posso falar com um atendente? Obrigada',
]

const NEGATIVE = [
  'São duas pessoas',
  'são 2 pessoas',
  'para uma pessoa',
  'É para uma pessoa só',
  'Quero agendar para duas pessoas',
  'Quero agendar para uma pessoa amanhã',
  'Posso levar uma pessoa comigo?',
  'Pessoa',
  'A atendente foi ótima',
  'ótima atendente',
  'Quero axila e pernas',
  'me passa o preço',
  'passa pra amanhã',
  'falar com a Gi',
  'Quero agendar uma depilação masculina para a próxima quarta',
  'A íntima inclui anus?',
  'tem horário humano?',
]

describe('wantsHumanText — pedido explícito de pessoa (DEC-083)', () => {
  it.each(POSITIVE)('«%s» → pedir_pessoa e pausa', (text) => {
    expect(wantsHumanText(text)).toBe(true)
    const hits = classifySensitive(text)
    expect(hits.map((h) => h.label)).toContain('pedir_pessoa')
    expect(wantsHumanPause(hits)).toBe(true)
  })

  it.each(NEGATIVE)('«%s» → não é pedido de pessoa', (text) => {
    expect(wantsHumanText(text)).toBe(false)
    expect(classifySensitive(text).map((h) => h.label)).not.toContain('pedir_pessoa')
  })

  it('transparência sobre IA continua separada (DEC-115)', () => {
    for (const text of ['Estou falando com uma pessoa?', 'Você é atendente?', 'é robô?']) {
      expect(wantsHumanText(text)).toBe(false)
      expect(classifySensitive(text).map((h) => h.label)).toContain('pergunta_ia')
    }
  })
})
