import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { bootAdminDb } from '../db/test-db'
import { adminDbAsD1 } from './test-d1'
import {
  CLIENT_WEB_LINK_TTL_MS,
  CLIENT_WEB_SESSION_TTL_MS,
  exchangeClientWebLink,
  getClientWebSession,
  issueClientWebLink,
  revokeClientWebSessions,
} from './links'

const LINK = {
  tenantId: 'clinic-a',
  bindingId: 'bind-a',
  contactId: 'ctc-1',
  conversationId: 'cnv-1',
  purpose: 'home' as const,
}

function setup() {
  const { db, close } = bootAdminDb()
  const clock = createControllableClock(1_800_000_000_000)
  return { admin: db, d1: adminDbAsD1(db), clock, close }
}

describe('link pessoal e sessão (DEC-199)', () => {
  it('troca única: a primeira abre sessão, a segunda recusa', async () => {
    const { d1, clock, close } = setup()
    try {
      const { token } = await issueClientWebLink(d1, clock, LINK)
      const first = await exchangeClientWebLink(d1, clock, token)
      expect(first).toMatchObject({
        tenantId: 'clinic-a',
        contactId: 'ctc-1',
        conversationId: 'cnv-1',
        purpose: 'home',
      })
      expect(first?.sessionToken.startsWith('cs1_')).toBe(true)
      expect(await exchangeClientWebLink(d1, clock, token)).toBeNull()
    } finally {
      close()
    }
  })

  it('duas trocas em paralelo: só uma ganha', async () => {
    const { d1, clock, close } = setup()
    try {
      const { token } = await issueClientWebLink(d1, clock, LINK)
      const [a, b] = await Promise.all([
        exchangeClientWebLink(d1, clock, token),
        exchangeClientWebLink(d1, clock, token),
      ])
      expect([a, b].filter(Boolean)).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('link expirado, inexistente ou malformado devolve null', async () => {
    const { d1, clock, close } = setup()
    try {
      const { token } = await issueClientWebLink(d1, clock, LINK)
      clock.advance(CLIENT_WEB_LINK_TTL_MS + 1)
      expect(await exchangeClientWebLink(d1, clock, token)).toBeNull()
      expect(await exchangeClientWebLink(d1, clock, 'cw1_naoexiste')).toBeNull()
      expect(await exchangeClientWebLink(d1, clock, 'fl1_outroPrefixo')).toBeNull()
      expect(await exchangeClientWebLink(d1, clock, '')).toBeNull()
    } finally {
      close()
    }
  })

  it('um link novo da mesma conversa invalida o anterior; outra conversa não é afetada', async () => {
    const { d1, clock, close } = setup()
    try {
      const old = await issueClientWebLink(d1, clock, LINK)
      const other = await issueClientWebLink(d1, clock, { ...LINK, conversationId: 'cnv-2' })
      const fresh = await issueClientWebLink(d1, clock, LINK)
      expect(await exchangeClientWebLink(d1, clock, old.token)).toBeNull()
      expect(await exchangeClientWebLink(d1, clock, fresh.token)).not.toBeNull()
      expect(await exchangeClientWebLink(d1, clock, other.token)).not.toBeNull()
    } finally {
      close()
    }
  })

  it('a sessão resolve até expirar e só vale para o seu tenant e contacto', async () => {
    const { d1, clock, close } = setup()
    try {
      const { token } = await issueClientWebLink(d1, clock, LINK)
      const ex = await exchangeClientWebLink(d1, clock, token)
      const session = await getClientWebSession(d1, clock, ex!.sessionToken)
      expect(session).toMatchObject({ tenantId: 'clinic-a', contactId: 'ctc-1', conversationId: 'cnv-1' })
      expect(await getClientWebSession(d1, clock, 'cs1_inventada')).toBeNull()
      expect(await getClientWebSession(d1, clock, token)).toBeNull() // o link não serve de sessão
      clock.advance(CLIENT_WEB_SESSION_TTL_MS + 1)
      expect(await getClientWebSession(d1, clock, ex!.sessionToken)).toBeNull()
    } finally {
      close()
    }
  })

  it('uma troca nova revoga a sessão anterior da mesma conversa', async () => {
    const { d1, clock, close } = setup()
    try {
      const a = await exchangeClientWebLink(d1, clock, (await issueClientWebLink(d1, clock, LINK)).token)
      const b = await exchangeClientWebLink(d1, clock, (await issueClientWebLink(d1, clock, LINK)).token)
      expect(await getClientWebSession(d1, clock, a!.sessionToken)).toBeNull()
      expect(await getClientWebSession(d1, clock, b!.sessionToken)).not.toBeNull()
    } finally {
      close()
    }
  })

  it('revokeClientWebSessions fecha as sessões da conversa ou da clínica', async () => {
    const { d1, clock, close } = setup()
    try {
      const a = await exchangeClientWebLink(d1, clock, (await issueClientWebLink(d1, clock, LINK)).token)
      const b = await exchangeClientWebLink(
        d1,
        clock,
        (await issueClientWebLink(d1, clock, { ...LINK, conversationId: 'cnv-2' })).token,
      )
      await revokeClientWebSessions(d1, clock, { tenantId: 'clinic-a', conversationId: 'cnv-1' })
      expect(await getClientWebSession(d1, clock, a!.sessionToken)).toBeNull()
      expect(await getClientWebSession(d1, clock, b!.sessionToken)).not.toBeNull()
      await revokeClientWebSessions(d1, clock, { tenantId: 'clinic-a' })
      expect(await getClientWebSession(d1, clock, b!.sessionToken)).toBeNull()
    } finally {
      close()
    }
  })

  it('o serviço reconhecido no chat viaja no link e sai na troca (DEC-202)', async () => {
    const { d1, clock, close } = setup()
    try {
      const withService = await issueClientWebLink(d1, clock, { ...LINK, purpose: 'agendar', serviceId: 'svc-massagem' })
      expect(await exchangeClientWebLink(d1, clock, withService.token)).toMatchObject({
        purpose: 'agendar',
        serviceId: 'svc-massagem',
        audienceLine: null,
        variantIds: [],
      })
      const plain = await issueClientWebLink(d1, clock, { ...LINK, conversationId: 'cnv-9' })
      expect(await exchangeClientWebLink(d1, clock, plain.token)).toMatchObject({ serviceId: null })
    } finally {
      close()
    }
  })

  it('linha e zonas do chat viajam no link e saem na troca (DEC-202, D-20261118-084800-CUR)', async () => {
    const { d1, clock, close } = setup()
    try {
      const rich = await issueClientWebLink(d1, clock, {
        ...LINK,
        purpose: 'agendar',
        serviceId: 'svc-laser',
        audienceLine: 'masculino',
        variantIds: ['z-ba', 'z-inválida'],
      })
      expect(await exchangeClientWebLink(d1, clock, rich.token)).toMatchObject({
        serviceId: 'svc-laser',
        audienceLine: 'masculino',
        variantIds: ['z-ba', 'z-inválida'],
      })
    } finally {
      close()
    }
  })

  it('não guarda o token nem a sessão em claro', async () => {
    const { admin, d1, clock, close } = setup()
    try {
      const { token } = await issueClientWebLink(d1, clock, LINK)
      const ex = await exchangeClientWebLink(d1, clock, token)
      const dump = JSON.stringify([
        admin.all('SELECT * FROM client_web_links'),
        admin.all('SELECT * FROM client_web_sessions'),
      ])
      expect(dump).not.toContain(token)
      expect(dump).not.toContain(ex!.sessionToken)
    } finally {
      close()
    }
  })
})
