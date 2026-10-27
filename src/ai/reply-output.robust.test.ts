import { describe, expect, it } from 'vitest'
import { parseReplyOutput } from './reply-output'

const MSG = 'Oi, Paulo! Amanhã tenho 13:00, 15:00 ou 16:00. Qual fica melhor?'

describe('parseReplyOutput — saída real dos modelos', () => {
  it('JSON limpo: só a mensagem; notas à parte', () => {
    const r = parseReplyOutput(JSON.stringify({ mensagem: MSG, notas: 'Confirmar sala.' }))
    expect(r).toEqual({ message: MSG, notes: 'Confirmar sala.' })
  })

  it('cerca ```json', () => {
    const r = parseReplyOutput('```json\n' + JSON.stringify({ mensagem: MSG, notas: '' }) + '\n```')
    expect(r.message).toBe(MSG)
  })

  it('prosa antes e depois do JSON', () => {
    const r = parseReplyOutput(`Claro, aqui está:\n${JSON.stringify({ mensagem: MSG, notas: 'x' })}\nEspero ter ajudado.`)
    expect(r.message).toBe(MSG)
    expect(r.notes).toBe('x')
  })

  it('JSON truncado (max_tokens): recupera a mensagem parcial e desfaz escapes', () => {
    const r = parseReplyOutput('{"mensagem": "Oi, Paulo!\\nSobre a depilação \\"masculina\\" amanhã à tar')
    expect(r.message).toBe('Oi, Paulo!\nSobre a depilação "masculina" amanhã à tar')
    expect(r.message).not.toMatch(/mensagem|[{}]/)
  })

  it('truncado a meio de um escape \\u', () => {
    const r = parseReplyOutput('{"mensagem": "Oi \\u00e9 bom\\u00')
    expect(r.message).toBe('Oi é bom')
  })

  it('pedaços acumulados (stream): cada prefixo nunca mostra JSON', () => {
    const full = JSON.stringify({ mensagem: MSG, notas: 'nota interna' })
    for (let i = 1; i <= full.length; i += 7) {
      const { message } = parseReplyOutput(full.slice(0, i))
      expect(message).not.toMatch(/[{}]|"mensagem"|notas|nota interna/)
    }
    expect(parseReplyOutput(full).message).toBe(MSG)
  })

  it('JSON sem mensagem: vazio (o painel mostra o erro amigável), nunca as chaves', () => {
    expect(parseReplyOutput('{"notas": "só nota"}').message).toBe('')
    expect(parseReplyOutput('{"mensagem": ').message).toBe('')
    expect(parseReplyOutput('{').message).toBe('')
  })

  it('texto solto continua aceito', () => {
    expect(parseReplyOutput(MSG).message).toBe(MSG)
  })
})
