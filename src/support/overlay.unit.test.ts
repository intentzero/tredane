import { describe, expect, it } from 'vitest'
import { matchSupportReadRoute, supportPermissionAllowed } from './overlay'

// Camadas de defesa independentes da lista de rotas: cada uma tem de falhar sozinha.
describe('overlay de suporte — camadas isoladas', () => {
  it('só GET casa com a lista de leitura', () => {
    const p = '/api/tenants/t1/inbox/conversations'
    expect(matchSupportReadRoute('GET', p)).not.toBeNull()
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'get']) {
      expect(matchSupportReadRoute(m, p)).toBeNull()
    }
  })

  it('permissões de escrita nunca passam, nem para owner', () => {
    expect(supportPermissionAllowed('owner', 'clinic.inbox.read')).toBe(true)
    for (const perm of ['clinic.inbox.write', 'clinic.config.write', 'clinic.members.manage', 'clinic.agenda.read']) {
      expect(supportPermissionAllowed('owner', perm as never)).toBe(false)
    }
  })
})
