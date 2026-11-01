/**
 * #435 (CF-24): a zona dita na mesma mensagem que a hora gera proposta, sem repetir
 * a pergunta das zonas. Quatro formulações do relatório, mais horas com «h» e «:».
 */
import { describe, expect, it } from 'vitest'
import { runDialogCase } from './evals/dialogs/runner'

const PHRASES: Array<[string, RegExp]> = [
  ['Quero depilação feminina de axila sexta às 10h', /R\$\s*40,00/],
  ['Quero a axila feminina na sexta às 10h', /R\$\s*40,00/],
  ['Quero depilação axila feminina sexta às 10h', /R\$\s*40,00/],
  ['Quero depilação masculina de axila sexta às 10h', /R\$\s*50,00/],
  ['Quero depilação feminina de axila sexta 10:00', /R\$\s*40,00/],
  ['Quero depilação feminina de axila sexta às 15h30', /R\$\s*40,00/],
]

describe('zona + hora na mesma mensagem (CF-24)', () => {
  it.each(PHRASES)('«%s» → proposta com a variante e o preço da linha', async (text, price) => {
    const r = await runDialogCase({
      id: 'CF-24',
      title: text,
      turnosIdeais: 1,
      turns: [{ role: 'client', text }],
      expect: { proposal: true, noAppointment: true, outboundExcludes: [/me diga as zonas/i] },
    })
    expect(r.error, r.error).toBeUndefined()
    expect(r.outbound.join('\n')).toMatch(price)
  }, 30_000)
})
