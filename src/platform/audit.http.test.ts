import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import { writeAudit } from '../db/admin'
import { createControllableClock } from '../db/clock'
import { createSimulatedEmailTransport, tokenFromInviteUrl } from '../email'
import { flattenMetadata, parseCursor } from './audit-list'

const SUPER = 'user_synth_superadmin'
const DAY = 86_400_000
const T0 = 3_100_000_000_000

function testApp(staffProfiles?: AuthServices['staffProfiles']) {
  const boot = bootAdminDb()
  const clock = createControllableClock(T0)
  const transport = createSimulatedEmailTransport({ clock })
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(boot.db),
    ...(staffProfiles ? { staffProfiles } : {}),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => boot.db,
    clockFactory: () => clock,
    emailFactory: () => transport,
    appBaseUrlFactory: () => 'http://localhost:5173',
  })
  const call = (user: string, path: string, init: { method?: string; json?: unknown } = {}) =>
    app.request(`http://localhost${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: synthAuthHeader(user),
        ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    })
  const log = (action: string, extra: Partial<Parameters<typeof writeAudit>[2]> = {}) =>
    writeAudit(boot.db, clock, {
      actorClerkUserId: SUPER,
      tenantId: 'clinic-demo-a',
      action,
      objectType: 'tenant',
      outcome: 'success',
      ...extra,
    })
  return { boot, clock, transport, call, log, close: boot.close }
}
type Ctx = ReturnType<typeof testApp>

type Ev = {
  id: string
  occurredAt: number
  action: string
  outcome: string
  tenantId: string | null
  tenantName: string | null
  actor: { clerkUserId: string; displayName: string | null } | null
  subject: { clerkUserId: string } | null
  supportSessionId: string | null
  metadata: Record<string, unknown>
}
type Page = { events: Ev[]; nextCursor: string | null }

const get = async (ctx: Ctx, path: string) => (await (await ctx.call(SUPER, path)).json()) as Page

describe('HTTP — auditoria na Platform Admin (#832)', () => {
  it('por clínica: só os eventos dela, mais recentes primeiro, com campos planos', async () => {
    const ctx = testApp()
    try {
      ctx.log('tenant.create', { metadata: { name: 'Clínica A' } })
      ctx.clock.advance(1000)
      ctx.log('tenant.suspend', { metadata: { to: 'suspended', reason: 'cobrança' }, subjectClerkUserId: 'user_x' })
      ctx.log('tenant.suspend', { tenantId: 'clinic-demo-b' })
      const page = await get(ctx, '/api/platform/tenants/clinic-demo-a/audit')
      expect(page.events.map((e) => e.action)).toEqual(['tenant.suspend', 'tenant.create'])
      expect(page.events[0]).toMatchObject({
        outcome: 'success',
        tenantId: 'clinic-demo-a',
        metadata: { to: 'suspended', reason: 'cobrança' },
        subject: { clerkUserId: 'user_x' },
        actor: { clerkUserId: SUPER },
      })
      expect(page.events[0]!.occurredAt).toBeGreaterThan(page.events[1]!.occurredAt)
      expect(page.nextCursor).toBeNull()
    } finally {
      ctx.close()
    }
  })

  it('metadados: segredos redigidos e valores aninhados viram texto; JSON estragado vira vazio', async () => {
    const ctx = testApp()
    try {
      ctx.log('invitation.create', { metadata: { email: 'a@b.co', token: 'abc123secret', nested: { x: 1 }, n: 3, ok: true } })
      const [ev] = (await get(ctx, '/api/platform/tenants/clinic-demo-a/audit')).events
      expect(ev!.metadata).toMatchObject({ email: 'a@b.co', n: 3, ok: true, nested: '{"x":1}' })
      expect(JSON.stringify(ev)).not.toContain('abc123secret')
      expect(flattenMetadata('{não é json')).toEqual({})
      expect(flattenMetadata('[1,2]')).toEqual({})
      expect(flattenMetadata(null)).toEqual({})
    } finally {
      ctx.close()
    }
  })

  it('filtra por categoria: clínica, owners e membros, suporte, e-mail; categoria inválida dá 400', async () => {
    const ctx = testApp()
    try {
      for (const a of ['tenant.create', 'owner.assign', 'membership.revoke', 'invitation.create', 'support.request.create', 'email.delivery.sent', 'whatsapp.connected']) {
        ctx.log(a)
        ctx.clock.advance(10)
      }
      const by = async (c: string) => (await get(ctx, `/api/platform/tenants/clinic-demo-a/audit?category=${c}`)).events.map((e) => e.action).sort()
      expect(await by('clinic')).toEqual(['tenant.create'])
      expect(await by('members')).toEqual(['invitation.create', 'membership.revoke', 'owner.assign'])
      expect(await by('support')).toEqual(['support.request.create'])
      expect(await by('email')).toEqual(['email.delivery.sent'])
      // «Tudo» inclui o que não tem categoria própria.
      expect((await get(ctx, '/api/platform/tenants/clinic-demo-a/audit')).events).toHaveLength(7)
      expect((await ctx.call(SUPER, '/api/platform/tenants/clinic-demo-a/audit?category=x')).status).toBe(400)
    } finally {
      ctx.close()
    }
  })

  it('período: 7, 30 (padrão) e 90 dias; outro valor dá 400', async () => {
    const ctx = testApp()
    try {
      ctx.log('tenant.create') // dia 0
      ctx.clock.advance(40 * DAY)
      ctx.log('tenant.update') // dia 40
      ctx.clock.advance(10 * DAY) // agora = dia 50
      ctx.log('tenant.suspend') // dia 50
      const days = async (d?: number) =>
        (await get(ctx, `/api/platform/tenants/clinic-demo-a/audit${d ? `?days=${d}` : ''}`)).events.map((e) => e.action)
      expect(await days()).toEqual(['tenant.suspend', 'tenant.update'])
      expect(await days(7)).toEqual(['tenant.suspend'])
      expect(await days(90)).toEqual(['tenant.suspend', 'tenant.update', 'tenant.create'])
      expect((await ctx.call(SUPER, '/api/platform/tenants/clinic-demo-a/audit?days=15')).status).toBe(400)
    } finally {
      ctx.close()
    }
  })

  it('cursor: percorre tudo sem repetir nem perder, mesmo com eventos no mesmo instante', async () => {
    const ctx = testApp()
    try {
      const made = Array.from({ length: 7 }, (_, i) => ctx.log(`tenant.step${i}`).id)
      const seen: string[] = []
      let cursor: string | null = null
      let pages = 0
      do {
        const page: Page = await get(ctx, `/api/platform/tenants/clinic-demo-a/audit?limit=3${cursor ? `&cursor=${cursor}` : ''}`)
        seen.push(...page.events.map((e) => e.id))
        cursor = page.nextCursor
        pages += 1
      } while (cursor)
      expect(pages).toBe(3)
      expect(seen).toHaveLength(7)
      expect(new Set(seen).size).toBe(7)
      expect([...seen].sort()).toEqual([...made].sort())
    } finally {
      ctx.close()
    }
  })

  it('eventos novos entre páginas não deslocam a página seguinte', async () => {
    const ctx = testApp()
    try {
      for (let i = 0; i < 4; i++) {
        ctx.log(`tenant.old${i}`)
        ctx.clock.advance(1000)
      }
      const first = await get(ctx, '/api/platform/tenants/clinic-demo-a/audit?limit=2')
      ctx.log('tenant.novo')
      const second = await get(ctx, `/api/platform/tenants/clinic-demo-a/audit?limit=2&cursor=${first.nextCursor}`)
      const ids = new Set(first.events.map((e) => e.id))
      expect(second.events.some((e) => ids.has(e.id))).toBe(false)
      expect(second.events.map((e) => e.action)).toEqual(['tenant.old1', 'tenant.old0'])
    } finally {
      ctx.close()
    }
  })

  it('limite e cursor inválidos dão 400; o limite máximo é 100', async () => {
    const ctx = testApp()
    try {
      for (const q of ['limit=0', 'limit=abc', 'limit=1.5', 'cursor=lixo', 'cursor=1.a b']) {
        expect((await ctx.call(SUPER, `/api/platform/tenants/clinic-demo-a/audit?${q}`)).status, q).toBe(400)
      }
      for (let i = 0; i < 120; i++) ctx.log(`tenant.bulk${i}`)
      const page = await get(ctx, '/api/platform/tenants/clinic-demo-a/audit?limit=500')
      expect(page.events).toHaveLength(100)
      expect(page.nextCursor).not.toBeNull()
      expect(parseCursor(page.nextCursor)).not.toBe('invalid')
    } finally {
      ctx.close()
    }
  })

  it('global: eventos de várias clínicas com o nome da clínica', async () => {
    const ctx = testApp()
    try {
      ctx.log('tenant.create', { tenantId: 'clinic-demo-a' })
      ctx.clock.advance(5)
      ctx.log('tenant.create', { tenantId: 'clinic-demo-b' })
      ctx.log('platform.noop', { tenantId: null })
      const page = await get(ctx, '/api/platform/audit?limit=10')
      expect(new Set(page.events.map((e) => e.tenantId))).toEqual(new Set(['clinic-demo-a', 'clinic-demo-b', null]))
      expect(page.events.find((e) => e.tenantId === 'clinic-demo-a')?.tenantName).toBeTruthy()
      expect(page.events.find((e) => e.tenantId === null)?.tenantName).toBeNull()
    } finally {
      ctx.close()
    }
  })

  it('nomes pelo Clerk; se o Clerk falha a lista continua com ids', async () => {
    const named = testApp({
      async readStaffProfiles(ids) {
        return new Map(ids.map((id) => [id, { displayName: `Nome ${id}`, email: null }]))
      },
    })
    try {
      named.log('tenant.create')
      expect((await get(named, '/api/platform/tenants/clinic-demo-a/audit')).events[0]!.actor?.displayName).toBe(`Nome ${SUPER}`)
    } finally {
      named.close()
    }
    const down = testApp({
      async readStaffProfiles() {
        throw new Error('clerk_down')
      },
    })
    try {
      down.log('tenant.create')
      const ev = (await get(down, '/api/platform/tenants/clinic-demo-a/audit')).events[0]!
      expect(ev.actor).toMatchObject({ clerkUserId: SUPER, displayName: null })
    } finally {
      down.close()
    }
  })

  it('o convite de owner real não deixa o token na auditoria', async () => {
    const ctx = testApp()
    try {
      const res = await ctx.call(SUPER, '/api/platform/tenants', {
        method: 'POST',
        json: { id: 'clinic-aud', name: 'Auditada', ownerEmail: 'dona@example.test' },
      })
      expect(res.status).toBe(201)
      const mail = ctx.transport.mailbox.at(-1)!
      const token = tokenFromInviteUrl((mail as { inviteUrl: string }).inviteUrl)!
      const raw = await (await ctx.call(SUPER, '/api/platform/tenants/clinic-aud/audit')).text()
      expect(raw).not.toContain(token)
      expect(JSON.parse(raw).events.map((e: Ev) => e.action)).toEqual(
        expect.arrayContaining(['tenant.create', 'invitation.create']),
      )
    } finally {
      ctx.close()
    }
  })

  it('404 se a clínica não existe; 403 para owners e flags não booleanas', async () => {
    const ctx = testApp()
    try {
      expect((await ctx.call(SUPER, '/api/platform/tenants/nao-existe/audit')).status).toBe(404)
      for (const user of ['user_synth_owner_a', 'user_synth_string_super', 'user_synth_public_super']) {
        for (const p of ['/api/platform/audit', '/api/platform/tenants/clinic-demo-a/audit']) {
          expect((await ctx.call(user, p)).status, `${user} ${p}`).toBe(403)
        }
      }
    } finally {
      ctx.close()
    }
  })
})
