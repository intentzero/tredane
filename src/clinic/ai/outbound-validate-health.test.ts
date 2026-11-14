/** DEC-046: o texto do LLM nunca dá orientação de saúde (staging 14/11/2026). */
import { describe, expect, it } from 'vitest'
import { validateClientOutbound } from './outbound-validate'

describe('validateClientOutbound — conselho de saúde (LLM)', () => {
  it.each([
    'Se o inchaço for forte, vale procurar um médico antes.',
    'Consulte um médico se tiver sintomas.',
    'Isso depende do diagnóstico, posso sugerir um remédio?',
    'Em caso de urgência, vá ao pronto-socorro.',
  ])('barra «%s»', (text) => {
    expect(validateClientOutbound(text, { source: 'llm' })).toEqual({ ok: false, reason: 'health_advice' })
  })

  it.each([
    'A equipe confirma os detalhes na segunda-feira, a partir das 09:00.',
    'Para drenagem linfática, o valor é R$ 200,00 e a duração, 60 min.',
    'A profissional confirma contigo antes da sessão.',
  ])('deixa passar «%s»', (text) => {
    expect(validateClientOutbound(text, { source: 'llm' }).ok).toBe(true)
  })

  it('não afeta as frases aprovadas (source phrase)', () => {
    expect(validateClientOutbound('Pergunte ao seu médico se pode.', { source: 'phrase', requireSingleQuestion: false }).ok).toBe(true)
  })
})
