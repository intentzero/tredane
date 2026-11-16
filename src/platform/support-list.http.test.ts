import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  createSyntheticStaffProfileReader,
  createSyntheticVerifiedEmailReader,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import { SUPPORT_REQUEST_TTL_MS, SUPPORT_SESSION_TTL_MS } from '../db/admin'
import { createControllableClock } from '../db/clock'
import { createSimulatedEmailTransport } from '../email'

const SUPER = 'user_synth_superadmin'
const OWNER = 'user_synth_owner_a'
const SUBJECT = 'user_synth_attendant_a'
const T0 = 3_100_000_000_000

function testApp(staffProfiles?: AuthServices['staffProfiles']) {
  const boot = bootAdminDb()
  const clock = createControllableClock(T0)
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(boot.db),
    verifiedEmails: createSyntheticVerifiedEmailReader(),
    staffProfiles: staffProfiles ?? createSyntheticStaffProfileReader(),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => boot.db,
    clockFactory: () => clock,
    emailFactory: () => createSimulatedEmailTransport({ clock }),
    appBaseUrlFactory: () => 'http://localhost:5173',
    eventPublisherFactory: () => ({
      async publishTenantEvent() {
        return { ok: true, seq: 1, delivered: [], revoked: [] }
      },
    }),
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
  return { boot, clock, call, close: boot.close }
}
type Ctx = ReturnType<typeof testApp>

type Item = {
  requestId: string
  tenantId: string
  tenantName: string
  state: string
  reason: string
  scope: string
  expiresAt: number
  remainingMs: number | null
  durationMs: number | null
  sessionId: string | null
  actor: { clerkUserId: string; displayName: string | null } | null
  subject: { clerkUserId: string } | null
  decider: { clerkUserId: string } | null
}

const list = async (ctx: Ctx, path = '/api/platform/support') =>
  ((await (await ctx.call(SUPER, path)).json()) as { items: Item[] }).items

async function request(ctx: Ctx, tenantId = 'clinic-demo-a', reason = 'Agenda não mostra a sala 2') {
  const res = await ctx.call(SUPER, '/api/platform/support-requests', {
    method: 'POST',
    json: { tenantId, subjectClerkUserId: SUBJECT, reason, scope: 'read_diagnostics' },
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { request: { id: string } }).request.id
}
const decide = (ctx: Ctx, id: string, decision: 'approve' | 'reject') =>
  ctx.call(OWNER, `/api/tenants/clinic-demo-a/support-requests/${id}/decision`, { method: 'POST', json: { decision } })

describe('HTTP — pedidos e sessões de suporte na Platform Admin (#831)', () => {
  it('pedido novo: «aguarda owner» com o prazo de 24 h, quem pediu e para quem', async () => {
    const ctx = testApp()
    try {
      const id = await request(ctx)
      const items = await list(ctx)
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        requestId: id,
        tenantId: 'clinic-demo-a',
        state: 'awaiting_owner',
        reason: 'Agenda não mostra a sala 2',
        scope: 'read_diagnostics',
        remainingMs: SUPPORT_REQUEST_TTL_MS,
        sessionId: null,
        durationMs: null,
        decider: null,
      })
      expect(items[0]!.tenantName).toBeTruthy()
      expect(items[0]!.actor?.clerkUserId).toBe(SUPER)
      expect(items[0]!.subject?.clerkUserId).toBe(SUBJECT)
    } finally {
      ctx.close()
    }
  })

  it('percorre os estados: aprovado → ativa → expirou (30 min usados); e pedido vencido', async () => {
    const ctx = testApp()
    try {
      const id = await request(ctx)
      expect((await decide(ctx, id, 'approve')).status).toBe(200)
      let [item] = await list(ctx)
      expect(item).toMatchObject({ state: 'approved', decider: { clerkUserId: OWNER } })

      const activated = await ctx.call(SUPER, `/api/platform/support-requests/${id}/activate`, { method: 'POST' })
      expect(activated.status).toBe(201)
      ;[item] = await list(ctx)
      expect(item).toMatchObject({ state: 'active', remainingMs: SUPPORT_SESSION_TTL_MS, durationMs: null })
      expect(item!.sessionId).toBeTruthy()

      ctx.clock.advance(10 * 60_000)
      ;[item] = await list(ctx)
      expect(item).toMatchObject({ state: 'active', remainingMs: SUPPORT_SESSION_TTL_MS - 10 * 60_000 })

      ctx.clock.advance(SUPPORT_SESSION_TTL_MS)
      ;[item] = await list(ctx)
      expect(item).toMatchObject({ state: 'session_expired', remainingMs: null, durationMs: SUPPORT_SESSION_TTL_MS })
    } finally {
      ctx.close()
    }
  })

  it('encerrada pelo actor e revogada pela owner são estados distintos, com a duração real', async () => {
    const ctx = testApp()
    try {
      const a = await request(ctx, 'clinic-demo-a', 'Primeiro')
      await decide(ctx, a, 'approve')
      const sa = (await (await ctx.call(SUPER, `/api/platform/support-requests/${a}/activate`, { method: 'POST' })).json()) as {
        session: { id: string }
      }
      ctx.clock.advance(12 * 60_000)
      expect((await ctx.call(SUPER, `/api/platform/support-sessions/${sa.session.id}/end`, { method: 'POST' })).status).toBe(200)
      let items = await list(ctx)
      expect(items.find((i) => i.requestId === a)).toMatchObject({ state: 'ended', durationMs: 12 * 60_000 })

      const b = await request(ctx, 'clinic-demo-a', 'Segundo')
      await decide(ctx, b, 'approve')
      const sb = (await (await ctx.call(SUPER, `/api/platform/support-requests/${b}/activate`, { method: 'POST' })).json()) as {
        session: { id: string }
      }
      ctx.clock.advance(9 * 60_000)
      expect((await ctx.call(OWNER, `/api/tenants/clinic-demo-a/support-sessions/${sb.session.id}/revoke`, { method: 'POST' })).status).toBe(200)
      items = await list(ctx)
      expect(items.find((i) => i.requestId === b)).toMatchObject({ state: 'revoked', durationMs: 9 * 60_000 })
    } finally {
      ctx.close()
    }
  })

  it('rejeitado e pedido vencido (24 h sem decisão)', async () => {
    const ctx = testApp()
    try {
      const a = await request(ctx, 'clinic-demo-a', 'Rejeitar')
      await decide(ctx, a, 'reject')
      const b = await request(ctx, 'clinic-demo-a', 'Vai vencer')
      expect((await list(ctx)).find((i) => i.requestId === a)?.state).toBe('rejected')
      ctx.clock.advance(SUPPORT_REQUEST_TTL_MS + 1)
      const items = await list(ctx)
      expect(items.find((i) => i.requestId === b)).toMatchObject({ state: 'request_expired', remainingMs: null })
    } finally {
      ctx.close()
    }
  })

  it('por clínica: só os pedidos dessa clínica, mais recentes primeiro; 404 se não existe', async () => {
    const ctx = testApp()
    try {
      await request(ctx, 'clinic-demo-a', 'A1')
      ctx.clock.advance(1000)
      await request(ctx, 'clinic-demo-a', 'A2')
      const own = await list(ctx, '/api/platform/tenants/clinic-demo-a/support')
      expect(own.map((i) => i.reason)).toEqual(['A2', 'A1'])
      expect(await list(ctx, '/api/platform/tenants/clinic-demo-b/support')).toEqual([])
      expect((await ctx.call(SUPER, '/api/platform/tenants/nao-existe/support')).status).toBe(404)
    } finally {
      ctx.close()
    }
  })

  it('nomes vêm do Clerk; se o Clerk falha a lista continua só com ids', async () => {
    const named = testApp({
      async readStaffProfiles(ids) {
        return new Map(ids.map((id) => [id, { displayName: `Nome ${id}`, email: null }]))
      },
    })
    try {
      await request(named)
      expect((await list(named))[0]!.actor?.displayName).toBe(`Nome ${SUPER}`)
    } finally {
      named.close()
    }
    const down = testApp({
      async readStaffProfiles() {
        throw new Error('clerk_down')
      },
    })
    try {
      await request(down)
      const items = await list(down)
      expect(items).toHaveLength(1)
      expect(items[0]!.actor).toMatchObject({ clerkUserId: SUPER, displayName: null })
    } finally {
      down.close()
    }
  })

  it('nunca expõe token, handoff nem conteúdo da clínica', async () => {
    const ctx = testApp()
    try {
      const id = await request(ctx)
      await decide(ctx, id, 'approve')
      const activated = (await (await ctx.call(SUPER, `/api/platform/support-requests/${id}/activate`, { method: 'POST' })).json()) as {
        handoffCode: string
      }
      const raw = await (await ctx.call(SUPER, '/api/platform/support')).text()
      expect(raw).not.toContain(activated.handoffCode)
      expect(raw).not.toMatch(/token|handoff/i)
      expect(JSON.parse(raw)).toMatchObject({ clinicalAccess: false })
    } finally {
      ctx.close()
    }
  })

  it('só o superadmin: owners e flags não booleanas recebem 403', async () => {
    const ctx = testApp()
    try {
      for (const user of [OWNER, 'user_synth_string_super', 'user_synth_public_super']) {
        for (const path of ['/api/platform/support', '/api/platform/tenants/clinic-demo-a/support']) {
          expect((await ctx.call(user, path)).status, `${user} ${path}`).toBe(403)
        }
      }
    } finally {
      ctx.close()
    }
  })
})
