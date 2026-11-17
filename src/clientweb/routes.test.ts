import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createControllableClock } from '../db/clock'
import { bootAdminDb } from '../db/test-db'
import type { WorkerBindings } from '../worker/bindings'
import { issueClientWebLink, CLIENT_WEB_SESSION_TTL_MS, type ClientWebSession } from './links'
import { adminDbAsD1 } from './test-d1'
import { createClientWebRoutes, CLIENT_WEB_COOKIE } from './routes'

const ORIGIN = 'https://app.test'
const ENV = { CLIENT_WEB_ENABLED: 'true' } as unknown as WorkerBindings
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
  const d1 = adminDbAsD1(db)
  const seen: ClientWebSession[] = []
  const app = new Hono<{ Bindings: WorkerBindings }>().route(
    '/',
    createClientWebRoutes({
      dbFactory: () => d1,
      clockFactory: () => clock,
      stateLookup: async (_env, session) => {
        seen.push(session)
        return {
          clinicName: 'Clínica Aurora',
          firstName: 'Marina',
          timezone: 'America/Sao_Paulo',
          appointments: [{ id: 'apt-1', serviceName: 'Limpeza de pele', startsAt: 1, endsAt: 2 }],
        }
      },
    }),
  )
  const post = (path: string, body: unknown, headers: Record<string, string> = { Origin: ORIGIN }, env = ENV) =>
    app.request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, env)
  const get = (path: string, cookie?: string, env = ENV) =>
    app.request(`${ORIGIN}${path}`, { headers: cookie ? { Cookie: cookie } : {} }, env)
  return { d1, clock, seen, post, get, close }
}

function sessionCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? ''
  return raw.split(';')[0] ?? ''
}

describe('rotas públicas da página web da cliente', () => {
  it('sem CLIENT_WEB_ENABLED responde 404 em todas as rotas', async () => {
    const { post, get, close } = setup()
    try {
      const off = {} as unknown as WorkerBindings
      expect((await post('/api/c/exchange', { token: 'x' }, { Origin: ORIGIN }, off)).status).toBe(404)
      expect((await get('/api/c/state', undefined, off)).status).toBe(404)
    } finally {
      close()
    }
  })

  it('exchange recusa pedido sem Origin ou com Origin alheio', async () => {
    const { post, close } = setup()
    try {
      expect((await post('/api/c/exchange', { token: 'x' }, {})).status).toBe(403)
      expect((await post('/api/c/exchange', { token: 'x' }, { Origin: 'https://evil.test' })).status).toBe(403)
    } finally {
      close()
    }
  })

  it('exchange válido abre a sessão com cookie seguro e cabeçalhos de privacidade', async () => {
    const { d1, clock, post, close } = setup()
    try {
      const { token } = await issueClientWebLink(d1, clock, LINK)
      const res = await post('/api/c/exchange', { token })
      expect(res.status).toBe(200)
      const cookie = res.headers.get('set-cookie') ?? ''
      expect(cookie).toContain(`${CLIENT_WEB_COOKIE}=cs1_`)
      expect(cookie).toMatch(/HttpOnly/i)
      expect(cookie).toMatch(/Secure/i)
      expect(cookie).toMatch(/SameSite=Strict/i)
      expect(cookie).toContain('Path=/api/c')
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.headers.get('referrer-policy')).toBe('no-referrer')
      expect(res.headers.get('x-robots-tag')).toBe('noindex')
      const body = await res.json()
      expect(JSON.stringify(body)).not.toMatch(/clinic-a|ctc-1|cnv-1/)
    } finally {
      close()
    }
  })

  it('segunda troca, token inexistente e corpo inválido dão a mesma resposta 410', async () => {
    const { d1, clock, post, close } = setup()
    try {
      const { token } = await issueClientWebLink(d1, clock, LINK)
      expect((await post('/api/c/exchange', { token })).status).toBe(200)
      const again = await post('/api/c/exchange', { token })
      const unknown = await post('/api/c/exchange', { token: 'cw1_naoexiste' })
      const junk = await post('/api/c/exchange', 'isto não é json')
      for (const r of [again, unknown, junk]) expect(r.status).toBe(410)
      expect(await again.json()).toEqual(await unknown.json())
    } finally {
      close()
    }
  })

  it('state exige sessão e devolve só o que a lookup devolve, com a clínica vinda da sessão', async () => {
    const { d1, clock, seen, post, get, close } = setup()
    try {
      expect((await get('/api/c/state')).status).toBe(401)
      expect((await get('/api/c/state', `${CLIENT_WEB_COOKIE}=cs1_inventada`)).status).toBe(401)

      const { token } = await issueClientWebLink(d1, clock, LINK)
      const cookie = sessionCookie(await post('/api/c/exchange', { token }))
      // Parâmetros de tenant/contacto no pedido são ignorados.
      const res = await get('/api/c/state?tenant_id=clinic-evil&contact_id=ctc-evil', cookie)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body).toMatchObject({ clinicName: 'Clínica Aurora', firstName: 'Marina' })
      expect(JSON.stringify(body)).not.toMatch(/clinic-a|ctc-1|cnv-1|tenant/)
      expect(seen).toEqual([
        expect.objectContaining({ tenantId: 'clinic-a', contactId: 'ctc-1', conversationId: 'cnv-1' }),
      ])
    } finally {
      close()
    }
  })

  it('state recusa sessão expirada', async () => {
    const { d1, clock, post, get, close } = setup()
    try {
      const { token } = await issueClientWebLink(d1, clock, LINK)
      const cookie = sessionCookie(await post('/api/c/exchange', { token }))
      clock.advance(CLIENT_WEB_SESSION_TTL_MS + 1)
      expect((await get('/api/c/state', cookie)).status).toBe(401)
    } finally {
      close()
    }
  })
})
