import { describe, expect, it } from 'vitest'
import { CLIENT_WEB_LINKS_PER_CONVERSATION } from '../../clientweb/offer'
import { runDialogCase } from './evals/dialogs/runner'

describe('limite de links por conversa (DEC-202)', () => {
  it('depois de 5 links na hora o chat passa à equipe em vez de repetir o botão', async () => {
    const turns = Array.from({ length: CLIENT_WEB_LINKS_PER_CONVERSATION + 2 }, () => ({
      role: 'client' as const,
      text: 'Quero marcar',
    }))
    const r = await runDialogCase({ id: 'LIMIT', title: 'limite de links', turnosIdeais: 7, turns })
    const links = r.outbound.filter((b) => /toque em «Abrir agenda»/.test(b))
    expect(links).toHaveLength(CLIENT_WEB_LINKS_PER_CONVERSATION)
    expect(r.appointments).toBe(0)
    // O 6.º pedido passa à equipe; o 7.º já não recebe nada automático.
    expect(r.outbound.length).toBe(CLIENT_WEB_LINKS_PER_CONVERSATION + 1)
  })
})
