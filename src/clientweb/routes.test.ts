import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createControllableClock } from '../db/clock'
import { bootAdminDb } from '../db/test-db'
import type { WorkerBindings } from '../worker/bindings'
import { issueClientWebLink, CLIENT_WEB_SESSION_TTL_MS, type ClientWebSession } from './links'
import { adminDbAsD1 } from './test-d1'
import { createClientWebRoutes, CLIENT_WEB_COOKIE, loadActiveTenantName } from './routes'

const ORIGIN = 'https://app.test'
const ENV = {} as unknown as WorkerBindings
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
          appointments: [
            {
              id: 'apt-1',
              serviceName: 'Limpeza de pele',
              startsAt: 1,
              endsAt: 2,
              serviceId: 'svc-1',
              professionalId: 'pro-1',
              professionalName: 'Gi',
              hasPaidSignal: false,
              zoneNames: [],
              comboName: null,
              priceCents: 12_000,
            },
          ],
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
  it('a página responde sem variável de ambiente (DEC-202, 18/11/2026)', async () => {
    const { get, close } = setup()
    try {
      const res = await get('/api/c/state')
      expect(res.status).not.toBe(404)
      expect(res.status).toBe(401)
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
      expect(body).toMatchObject({ ok: true, purpose: 'home', appointmentId: null, serviceId: null })
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

  it('exchange devolve 429 com Retry-After depois de muitos pedidos do mesmo IP', async () => {
    const { post, close } = setup()
    try {
      const h = { Origin: ORIGIN, 'cf-connecting-ip': '198.51.100.7' }
      let last: Response | null = null
      for (let i = 0; i < 21; i++) last = await post('/api/c/exchange', { token: 'cw1_naoexiste' }, h)
      expect(last?.status).toBe(429)
      expect(Number(last?.headers.get('retry-after'))).toBeGreaterThan(0)
      // Outro IP não é afetado.
      const other = await post('/api/c/exchange', { token: 'cw1_naoexiste' }, { Origin: ORIGIN, 'cf-connecting-ip': '198.51.100.8' })
      expect(other.status).toBe(410)
    } finally {
      close()
    }
  })
})

describe('clínica ativa (ADR-0018 §7a)', () => {
  it('só uma clínica ativa serve a página', async () => {
    const { db, close } = bootAdminDb()
    try {
      const d1 = adminDbAsD1(db)
      const id = (db.get('SELECT id FROM tenants LIMIT 1') as { id: string }).id
      expect(await loadActiveTenantName(d1, id)).toBeTruthy()
      db.run("UPDATE tenants SET status = 'suspended' WHERE id = ?", id)
      expect(await loadActiveTenantName(d1, id)).toBeNull()
      db.run("UPDATE tenants SET status = 'pending_deletion' WHERE id = ?", id)
      expect(await loadActiveTenantName(d1, id)).toBeNull()
      expect(await loadActiveTenantName(d1, 'inexistente')).toBeNull()
    } finally {
      close()
    }
  })
})

describe('catálogo, horas e Confirmar (Fase 2)', () => {
  const CATALOG = { timezone: 'America/Sao_Paulo', horizonDays: 30, today: '2026-11-17', services: [] }

  function setupGateway() {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(1_800_000_000_000)
    const d1 = adminDbAsD1(db)
    const seen: Array<{ kind: string; session: ClientWebSession; input?: unknown }> = []
    const app = new Hono<{ Bindings: WorkerBindings }>().route(
      '/',
      createClientWebRoutes({
        dbFactory: () => d1,
        clockFactory: () => clock,
        stateLookup: async () => ({ clinicName: 'Clínica Aurora', firstName: null, timezone: 'America/Sao_Paulo', appointments: [] }),
        catalogLookup: async (_e, session) => {
          seen.push({ kind: 'catalog', session })
          return CATALOG
        },
        slotsLookup: async (_e, session, input) => {
          seen.push({ kind: 'slots', session, input })
          return { ok: true, slots: [{ id: '2026-11-18T10:00', date: '2026-11-18', time: '10:00' }], from: input.from, to: input.to, emptyDays: [] }
        },
        bookLookup: async (_e, session, input) => {
          seen.push({ kind: 'book', session, input })
          return {
            status: 'booked',
            appointment: {
              id: 'apt-9',
              startsAt: 1,
              endsAt: 2,
              serviceName: 'Limpeza',
              professionalName: 'Gi',
            },
          }
        },
      }),
    )
    const call = (method: 'GET' | 'POST', path: string, cookie?: string, body?: unknown) =>
      app.request(
        `${ORIGIN}${path}`,
        {
          method,
          headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        },
        ENV,
      )
    const login = async () => {
      const { token } = await issueClientWebLink(d1, clock, LINK)
      return sessionCookie(await call('POST', '/api/c/exchange', undefined, { token }))
    }
    return { call, login, seen, close }
  }

  it('sem sessão as três rotas respondem 401', async () => {
    const { call, close } = setupGateway()
    try {
      expect((await call('GET', '/api/c/catalog')).status).toBe(401)
      expect((await call('POST', '/api/c/availability', undefined, { serviceId: 's', variantIds: [], from: '2026-11-18', to: '2026-11-18' })).status).toBe(401)
      expect((await call('POST', '/api/c/book', undefined, { serviceId: 's', variantIds: [], line: null, slotId: '2026-11-18T10:00' })).status).toBe(401)
    } finally {
      close()
    }
  })

  it('com sessão, a clínica e o contacto vêm só da sessão, nunca do pedido', async () => {
    const { call, login, seen, close } = setupGateway()
    try {
      const cookie = await login()
      expect((await call('GET', '/api/c/catalog', cookie)).status).toBe(200)
      const slots = await call('POST', '/api/c/availability', cookie, {
        serviceId: 'svc-1', variantIds: ['z1'], from: '2026-11-18', to: '2026-11-24', tenantId: 'clinic-evil', contactId: 'ctc-evil',
      })
      expect(slots.status).toBe(200)
      expect((await slots.json()) as { slots: unknown[] }).toMatchObject({ slots: [{ id: '2026-11-18T10:00' }] })
      const booked = await call('POST', '/api/c/book', cookie, {
        serviceId: 'svc-1', variantIds: [], line: 'feminino', slotId: '2026-11-18T10:00', tenantId: 'clinic-evil', contactId: 'ctc-evil',
      })
      expect(await booked.json()).toMatchObject({ status: 'booked' })
      for (const s of seen) {
        expect(s.session).toMatchObject({ tenantId: 'clinic-a', contactId: 'ctc-1', conversationId: 'cnv-1' })
        expect(JSON.stringify(s.input ?? {})).not.toMatch(/evil/)
      }
    } finally {
      close()
    }
  })

  it('valida o corpo: campos em falta, tipos errados, hora mal formada e linha inválida dão 400', async () => {
    const { call, login, close } = setupGateway()
    try {
      const cookie = await login()
      const bad = [
        { variantIds: [], from: '2026-11-18', to: '2026-11-18' },
        { serviceId: 's', variantIds: 'z1', from: '2026-11-18', to: '2026-11-18' },
        { serviceId: 's', variantIds: [], from: 'amanhã', to: '2026-11-18' },
      ]
      for (const b of bad) expect((await call('POST', '/api/c/availability', cookie, b)).status).toBe(400)
      const badBook = [
        { variantIds: [], line: null, slotId: '2026-11-18T10:00' },
        { serviceId: 's', variantIds: [], line: null, slotId: 'segunda às 10' },
        { serviceId: 's', variantIds: [], line: 'outro', slotId: '2026-11-18T10:00' },
        { serviceId: 's', variantIds: new Array(21).fill('z'), line: null, slotId: '2026-11-18T10:00' },
      ]
      for (const b of badBook) expect((await call('POST', '/api/c/book', cookie, b)).status).toBe(400)
    } finally {
      close()
    }
  })

  it('POST sem Origin é recusado também nas rotas novas', async () => {
    const { login, close } = setupGateway()
    try {
      const cookie = await login()
      const app = new Hono<{ Bindings: WorkerBindings }>().route('/', createClientWebRoutes({ stateLookup: async () => null }))
      const res = await app.request(`${ORIGIN}/api/c/book`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' }, ENV)
      expect(res.status).toBe(403)
    } finally {
      close()
    }
  })
})

describe('remarcar, cancelar e pedir à equipe (Fases 3 e 4)', () => {
  function setupManage() {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(1_800_000_000_000)
    const d1 = adminDbAsD1(db)
    const seen: Array<{ kind: string; session: ClientWebSession; input?: unknown }> = []
    const app = new Hono<{ Bindings: WorkerBindings }>().route(
      '/',
      createClientWebRoutes({
        dbFactory: () => d1,
        clockFactory: () => clock,
        stateLookup: async () => ({ clinicName: 'Clínica Aurora', firstName: null, timezone: 'America/Sao_Paulo', appointments: [] }),
        rescheduleSlotsLookup: async (_e, session, input) => {
          seen.push({ kind: 'rslots', session, input })
          return input.appointmentId === 'apt-outra'
            ? { ok: false, error: 'appointment_not_found' }
            : { ok: true, slots: [{ id: '2026-11-18T10:00', date: '2026-11-18', time: '10:00' }], from: input.from, to: input.to, emptyDays: [] }
        },
        rescheduleLookup: async (_e, session, input) => {
          seen.push({ kind: 'reschedule', session, input })
          return {
            status: 'booked',
            appointment: {
              id: input.appointmentId,
              startsAt: 1,
              endsAt: 2,
              serviceName: 'Limpeza',
              professionalName: 'Gi',
            },
          }
        },
        cancelLookup: async (_e, session, input) => {
          seen.push({ kind: 'cancel', session, input })
          return { status: 'needs_team' }
        },
        askTeamLookup: async (_e, session) => {
          seen.push({ kind: 'ask', session })
          return { status: 'asked' }
        },
      }),
    )
    const call = (path: string, cookie?: string, body?: unknown) =>
      app.request(
        `${ORIGIN}${path}`,
        { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body ?? {}) },
        ENV,
      )
    const login = async () => {
      const { token } = await issueClientWebLink(d1, clock, LINK)
      return sessionCookie(await call('/api/c/exchange', undefined, { token }))
    }
    return { call, login, seen, close }
  }

  it('sem sessão as rotas novas respondem 401', async () => {
    const { call, close } = setupManage()
    try {
      expect((await call('/api/c/reschedule', undefined, { appointmentId: 'a', slotId: '2026-11-18T10:00' })).status).toBe(401)
      expect((await call('/api/c/cancel', undefined, { appointmentId: 'a' })).status).toBe(401)
      expect((await call('/api/c/ask-team')).status).toBe(401)
    } finally {
      close()
    }
  })

  it('com sessão, tudo é da sessão; nada de tenant ou contacto vindo do pedido', async () => {
    const { call, login, seen, close } = setupManage()
    try {
      const cookie = await login()
      const slots = await call('/api/c/availability', cookie, { appointmentId: 'apt-1', from: '2026-11-18', to: '2026-11-24', tenantId: 'clinic-evil' })
      expect(slots.status).toBe(200)
      expect(await slots.json()).toMatchObject({ slots: [{ id: '2026-11-18T10:00' }] })
      expect((await call('/api/c/reschedule', cookie, { appointmentId: 'apt-1', slotId: '2026-11-18T10:00', contactId: 'ctc-evil' })).status).toBe(200)
      expect(await (await call('/api/c/cancel', cookie, { appointmentId: 'apt-1' })).json()).toEqual({ status: 'needs_team' })
      expect(await (await call('/api/c/ask-team', cookie)).json()).toEqual({ status: 'asked' })
      for (const s of seen) {
        expect(s.session).toMatchObject({ tenantId: 'clinic-a', contactId: 'ctc-1', conversationId: 'cnv-1' })
        expect(JSON.stringify(s.input ?? {})).not.toMatch(/evil/)
      }
    } finally {
      close()
    }
  })

  it('marcação de outra cliente nas horas para remarcar dá 404; corpo inválido dá 400', async () => {
    const { call, login, close } = setupManage()
    try {
      const cookie = await login()
      expect((await call('/api/c/availability', cookie, { appointmentId: 'apt-outra', from: '2026-11-18', to: '2026-11-24' })).status).toBe(404)
      expect((await call('/api/c/availability', cookie, { appointmentId: 5, from: '2026-11-18', to: '2026-11-24' })).status).toBe(400)
      expect((await call('/api/c/reschedule', cookie, { appointmentId: 'a', slotId: 'amanhã' })).status).toBe(400)
      expect((await call('/api/c/reschedule', cookie, { slotId: '2026-11-18T10:00' })).status).toBe(400)
      expect((await call('/api/c/cancel', cookie, {})).status).toBe(400)
    } finally {
      close()
    }
  })

  it('exchange devolve a finalidade e a marcação alvo do link (remarcar e cancelar)', async () => {
    const { d1, clock, post, close } = setup()
    try {
      const { token } = await issueClientWebLink(d1, clock, { ...LINK, purpose: 'cancelar', appointmentId: 'apt-7' })
      const res = await post('/api/c/exchange', { token })
      expect(await res.json()).toMatchObject({ ok: true, purpose: 'cancelar', appointmentId: 'apt-7' })
    } finally {
      close()
    }
  })
})
