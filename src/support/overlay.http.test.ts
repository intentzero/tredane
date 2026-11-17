/**
 * Testes ADVERSARIAIS do overlay de sessão de suporte (#853 PR 2, ADR-0017 camada 2 da revisão de segurança).
 * Cada teste tenta abrir algo que não devia: o que se prova é o que **não** acontece.
 */
import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticSessionAuthenticator,
  createSyntheticStaffProfileReader,
  createSyntheticVerifiedEmailReader,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import { bootClinicDb } from '../clinic/test-db'
import { createMemoryInboxRegistry } from '../inbox/gateway'
import {
  approveSupportRequest,
  createSupportAccessRequest,
  listAuditForTenant,
  revokeMembership,
  SUPPORT_SESSION_TTL_MS,
} from '../db/admin'
import { createControllableClock } from '../db/clock'
import { createSimulatedEmailTransport } from '../email'

const SUPER = 'user_synth_superadmin'
const OWNER_A = 'user_synth_owner_a'
const ATT_A = 'user_synth_attendant_a'
const T0 = 3_100_000_000_000
const A = 'clinic-demo-a'
const B = 'clinic-demo-b'

function testApp() {
  const admin = bootAdminDb()
  const clock = createControllableClock(T0)
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const registry = createMemoryInboxRegistry((tenantId) => {
    let boot = clinics.get(tenantId)
    if (!boot) {
      boot = bootClinicDb()
      clinics.set(tenantId, boot)
    }
    return { db: boot.db, clock: boot.clock }
  })
  // A flag de superadmin pode ser retirada a meio da sessão.
  const authority = {
    state: { mode: 'super' as 'super' | 'removed' | 'down' },
    async readUserAuthority(id: string) {
      if (this.state.mode === 'down') throw new Error('clerk_down')
      const isSuper = id === SUPER && this.state.mode === 'super'
      return { clerkUserId: id, privateSuperadmin: isSuper ? true : undefined, publicSuperadmin: undefined }
    },
  }
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
    authority,
    adminDb: asyncFromSync(admin.db),
    verifiedEmails: createSyntheticVerifiedEmailReader(),
    staffProfiles: createSyntheticStaffProfileReader(),
    clock,
  }
  const transport = createSimulatedEmailTransport({ clock })
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => admin.db,
    inboxGatewayFactory: (_env, tenantId) => registry(tenantId),
    clockFactory: () => clock,
    emailFactory: () => transport,
    appBaseUrlFactory: () => 'http://localhost:5173',
    eventPublisherFactory: () => ({
      async publishTenantEvent() {
        return { ok: true, seq: 1, delivered: [], revoked: [] }
      },
    }),
  })
  const call = (
    user: string,
    path: string,
    init: { method?: string; json?: unknown; session?: string; cookie?: string; env?: Record<string, string>; headers?: Record<string, string> } = {},
  ) => {
    const headers: Record<string, string> = { Authorization: synthAuthHeader(user), Origin: 'http://localhost:5173', ...init.headers }
    if (init.session) headers['X-Synth-Session'] = init.session
    if (init.cookie) headers.Cookie = init.cookie
    if (init.json !== undefined) headers['Content-Type'] = 'application/json'
    return app.request(
      `http://localhost${path}`,
      { method: init.method ?? 'GET', headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined },
      init.env as never,
    )
  }
  const auditOf = (tenantId: string, action: string) =>
    listAuditForTenant(admin.db, tenantId, { limit: 500 }).filter((e) => e.action === action)
  const close = () => {
    for (const c of clinics.values()) c.close()
    admin.close()
  }
  return { admin, clock, authority, call, auditOf, close }
}
type Ctx = ReturnType<typeof testApp>
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Json
const cleared = (res: Response) => /tredane_support=;/.test(res.headers.get('Set-Cookie') ?? '')

/** Pedido aprovado e sessão ativa de verdade (ativar + handoff), devolvendo o cookie. */
async function openSupport(ctx: Ctx, opts: { subject?: string; tenant?: string; session?: string } = {}) {
  const tenant = opts.tenant ?? A
  const req = createSupportAccessRequest(ctx.admin.db, ctx.clock, {
    tenantId: tenant,
    actorClerkUserId: SUPER,
    subjectClerkUserId: opts.subject ?? ATT_A,
    reason: 'diagnóstico',
    scope: 'read_diagnostics',
  })
  approveSupportRequest(ctx.admin.db, ctx.clock, { requestId: req.id, ownerClerkUserId: tenant === A ? OWNER_A : 'user_synth_owner_b' })
  const session = opts.session ?? 'sess_a'
  const act = await json(await ctx.call(SUPER, `/api/platform/support-requests/${req.id}/activate`, { method: 'POST', session }))
  const handoff = await ctx.call(SUPER, '/api/support/handoff', { method: 'POST', json: { handoffCode: act.handoffCode }, session })
  expect(handoff.status).toBe(200)
  const cookie = `tredane_support=${/tredane_support=([^;]+)/.exec(handoff.headers.get('Set-Cookie') ?? '')![1]}`
  return { cookie, sessionId: act.session.id as string, session }
}
const seedInbox = async (ctx: Ctx) => {
  const res = await ctx.call(ATT_A, `/api/tenants/${A}/inbox/seed-demo`, { method: 'POST', json: {} })
  expect(res.status).toBe(200)
}

describe('overlay de suporte — o que funciona', () => {
  it('lê o contexto com o papel do subject e as conversas com texto, sem o telefone inteiro', async () => {
    const ctx = testApp()
    try {
      await seedInbox(ctx)
      const { cookie, session } = await openSupport(ctx)
      const context = await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session })
      expect(context.status).toBe(200)
      // O papel é o do subject (attendant), não um privilégio do superadmin.
      expect(await json(context)).toMatchObject({ tenantId: A, role: 'attendant' })

      const list = await ctx.call(SUPER, `/api/tenants/${A}/inbox/conversations`, { cookie, session })
      expect(list.status).toBe(200)
      const convs = (await json(list)).conversations as Json[]
      expect(convs.length).toBeGreaterThan(0)
      const detail = await json(await ctx.call(SUPER, `/api/tenants/${A}/inbox/conversations/${convs[0]!.id}`, { cookie, session }))
      expect((detail.messages as Json[]).length).toBeGreaterThan(0)
      expect(typeof (detail.messages as Json[])[0]!.body).toBe('string')

      // Nenhum telefone completo em lado nenhum da resposta.
      const raw = JSON.stringify([convs, detail, await json(await ctx.call(SUPER, `/api/tenants/${A}/inbox/contacts`, { cookie, session }))])
      const waIds = [...raw.matchAll(/"waId":"([^"]*)"/g)].map((m) => m[1]!)
      expect(waIds.length).toBeGreaterThan(0)
      for (const w of waIds) expect(w).toMatch(/^••••\d{0,4}$/)
    } finally {
      ctx.close()
    }
  })

  it('quem não está em sessão de suporte vê o telefone inteiro e não deixa rasto de suporte', async () => {
    const ctx = testApp()
    try {
      await seedInbox(ctx)
      const res = await json(await ctx.call(ATT_A, `/api/tenants/${A}/inbox/contacts`))
      const raw = JSON.stringify(res)
      expect([...raw.matchAll(/"waId":"([^"]*)"/g)].some((m) => /\d{7,}/.test(m[1]!))).toBe(true)
      expect(ctx.auditOf(A, 'support.access')).toHaveLength(0)
    } finally {
      ctx.close()
    }
  })

  it('cada leitura fica auditada, agregada por sessão, rota e minuto', async () => {
    const ctx = testApp()
    try {
      const { cookie, session, sessionId } = await openSupport(ctx)
      for (let i = 0; i < 5; i++) await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session })
      await ctx.call(SUPER, `/api/tenants/${A}/inbox/conversations`, { cookie, session })
      let rows = ctx.auditOf(A, 'support.access')
      expect(rows.map((r) => JSON.parse(r.metadataJson!).route).sort()).toEqual(['context', 'inbox.conversations'])
      expect(rows.every((r) => r.supportSessionId === sessionId && r.actorClerkUserId === SUPER && r.subjectClerkUserId === ATT_A)).toBe(true)
      ctx.clock.advance(60_000)
      await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session })
      rows = ctx.auditOf(A, 'support.access')
      expect(rows).toHaveLength(3)
    } finally {
      ctx.close()
    }
  })
})

describe('overlay de suporte — escrita e rotas fora da lista', () => {
  it('nenhuma escrita passa, mesmo em rotas que só pedem uma permissão de leitura, e o estado não muda', async () => {
    const ctx = testApp()
    try {
      await seedInbox(ctx)
      const { cookie, session } = await openSupport(ctx)
      const before = (await json(await ctx.call(SUPER, `/api/tenants/${A}/inbox/conversations`, { cookie, session }))).conversations.length
      const attempts: Array<[string, string, unknown?]> = [
        ['POST', `/api/tenants/${A}/inbox/seed-demo`, {}],
        ['POST', `/api/tenants/${A}/inbox/conversations/x/messages`, { body: 'olá' }],
        ['POST', `/api/tenants/${A}/inbox/conversations/x/read`, {}],
        ['POST', `/api/tenants/${A}/inbox/conversations/x/assign`, {}],
        ['POST', `/api/tenants/${A}/inbox/conversations/x/close`, {}],
        ['PUT', `/api/tenants/${A}/config/services/x`, {}],
        ['POST', `/api/tenants/${A}/realtime/ticket`, {}],
        ['POST', `/api/tenants/${A}/push/subscriptions`, {}],
        ['POST', `/api/tenants/${A}/members/${ATT_A}/revoke`, {}],
        ['POST', `/api/tenants/${A}/pipeline/opportunities/x/move`, {}],
      ]
      for (const [method, path, body] of attempts) {
        const res = await ctx.call(SUPER, path, { method, json: body, cookie, session })
        expect([res.status, (await json(res)).error], `${method} ${path}`).toEqual([403, 'support_write_blocked'])
      }
      const after = (await json(await ctx.call(SUPER, `/api/tenants/${A}/inbox/conversations`, { cookie, session }))).conversations.length
      expect(after).toBe(before)
      // As tentativas ficam registadas (agregadas por minuto), para a revisão ver quem tentou o quê.
      expect(ctx.auditOf(A, 'support.access.denied').length).toBeGreaterThan(0)
    } finally {
      ctx.close()
    }
  })

  it('rotas de leitura fora da lista (equipe, configuração, agenda, reservas, tempo real, push, suporte, WhatsApp) respondem 403 mesmo com subject owner', async () => {
    const ctx = testApp()
    try {
      const { cookie, session } = await openSupport(ctx, { subject: OWNER_A })
      for (const path of [
        `/api/tenants/${A}/team`,
        `/api/tenants/${A}/config`,
        `/api/tenants/${A}/config/readiness`,
        `/api/tenants/${A}/agenda`,
        `/api/tenants/${A}/holds`,
        `/api/tenants/${A}/realtime/snapshot`,
        `/api/tenants/${A}/push/subscriptions`,
        `/api/tenants/${A}/support-requests`,
        `/api/tenants/${A}/support-sessions`,
        `/api/tenants/${A}/whatsapp`,
      ]) {
        const res = await ctx.call(SUPER, path, { cookie, session })
        expect([res.status, (await json(res)).error], path).toEqual([403, 'support_route_blocked'])
      }
      // Variações de caminho que tentem contornar a lista nunca devolvem dados.
      for (const trick of [`/api/tenants/${A}/inbox/conversations/`, `/api/tenants/${A}/context/`, `/api/tenants/${A}/inbox/../team`, `/api/tenants/${A}//team`]) {
        const res = await ctx.call(SUPER, trick, { cookie, session })
        expect(res.status, trick).not.toBe(200)
      }
    } finally {
      ctx.close()
    }
  })

  it('o suporte não aprova, revoga nem encerra pelas rotas da clínica (nem sequer a sua própria sessão)', async () => {
    const ctx = testApp()
    try {
      const { cookie, session, sessionId } = await openSupport(ctx, { subject: OWNER_A })
      const res = await ctx.call(SUPER, `/api/tenants/${A}/support-sessions/${sessionId}/revoke`, { method: 'POST', cookie, session })
      expect([res.status, (await json(res)).error]).toEqual([403, 'support_write_blocked'])
      const row = ctx.admin.db.get<{ status: string }>(`SELECT status FROM support_sessions WHERE id = ?`, sessionId)
      expect(row?.status).toBe('active')
      const dec = await ctx.call(SUPER, `/api/tenants/${A}/support-requests/x/decision`, { method: 'POST', json: { decision: 'approve' }, cookie, session })
      expect(dec.status).toBe(403)
    } finally {
      ctx.close()
    }
  })

  it('um papel forjado no cabeçalho é recusado', async () => {
    const ctx = testApp()
    try {
      const { cookie, session } = await openSupport(ctx)
      const res = await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session, headers: { 'X-Claimed-Role': 'owner' } })
      expect([res.status, (await json(res)).error]).toEqual([403, 'forged_role_rejected'])
    } finally {
      ctx.close()
    }
  })
})

describe('overlay de suporte — isolamento e identidade', () => {
  it('o cookie de uma clínica não abre outra, e o superadmin sem sessão não abre nada por ser superadmin', async () => {
    const ctx = testApp()
    try {
      const { cookie, session } = await openSupport(ctx)
      const other = await ctx.call(SUPER, `/api/tenants/${B}/context`, { cookie, session })
      expect([other.status, (await json(other)).error]).toEqual([403, 'support_tenant_forged'])
      // Recusado e limpo: o cookie não fica a bloquear o resto da navegação.
      expect(cleared(other)).toBe(true)
      // A flag de superadmin, sozinha, não abre conteúdo de clínica nenhuma (ADR-0006 §6).
      for (const t of [A, B]) {
        const bare = await ctx.call(SUPER, `/api/tenants/${t}/context`, { session })
        expect([bare.status, (await json(bare)).error], t).toEqual([403, 'tenant_access_denied'])
      }
    } finally {
      ctx.close()
    }
  })

  it('outra sessão Clerk do mesmo actor, outro utilizador e cookies forjados são recusados e o cookie é limpo', async () => {
    const ctx = testApp()
    try {
      const { cookie } = await openSupport(ctx, { session: 'sess_a' })
      const otherSession = await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session: 'sess_outra' })
      expect([otherSession.status, (await json(otherSession)).error]).toEqual([403, 'support_clerk_session_mismatch'])
      expect(cleared(otherSession)).toBe(true)

      const otherUser = await ctx.call(OWNER_A, `/api/tenants/${A}/context`, { cookie, session: 'sess_a' })
      expect(otherUser.status).toBe(403)
      expect(cleared(otherUser)).toBe(true)
      // Mesmo sendo owner legítima da clínica: com o cookie de suporte na mão não ganha nada.
      expect((await json(otherUser)).error).toBe('superadmin_required')

      for (const bad of ['tredane_support=lixo', 'tredane_support=', `${cookie}x`]) {
        const res = await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie: bad, session: 'sess_a' })
        expect(res.status, bad).toBe(403)
      }
    } finally {
      ctx.close()
    }
  })

  it('retirar a flag de superadmin, ou o Clerk não responder, corta a sessão no pedido seguinte (fail closed)', async () => {
    for (const mode of ['removed', 'down'] as const) {
      const ctx = testApp()
      try {
        const { cookie, session } = await openSupport(ctx)
        expect((await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session })).status).toBe(200)
        ctx.authority.state.mode = mode
        const res = await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session })
        expect(res.status, mode).toBe(403)
        expect(cleared(res), mode).toBe(true)
        ctx.authority.state.mode = 'super'
        // Voltando a flag, o cookie já foi limpo e a sessão deixou de abrir sozinha? Não: o cookie perdeu valor no cliente,
        // mas a linha continua ativa até ao prazo; o que importa é que enquanto a flag falta nada abre.
      } finally {
        ctx.close()
      }
    }
  })
})

describe('overlay de suporte — a sessão acaba', () => {
  it('prazo de 30 min: no pedido seguinte já não abre, sem renovar por uso', async () => {
    const ctx = testApp()
    try {
      const { cookie, session, sessionId } = await openSupport(ctx)
      ctx.clock.advance(SUPPORT_SESSION_TTL_MS - 60_000)
      // Usar a sessão perto do fim não a prolonga.
      expect((await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session })).status).toBe(200)
      ctx.clock.advance(61_000)
      const res = await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session })
      expect(res.status).toBe(403)
      expect(cleared(res)).toBe(true)
      expect(ctx.admin.db.get<{ status: string }>(`SELECT status FROM support_sessions WHERE id = ?`, sessionId)?.status).toBe('expired')
    } finally {
      ctx.close()
    }
  })

  it('revogada pela owner, ou encerrada pelo actor: a leitura seguinte já falha', async () => {
    const ctx = testApp()
    try {
      const a = await openSupport(ctx)
      expect((await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie: a.cookie, session: a.session })).status).toBe(200)
      expect((await ctx.call(OWNER_A, `/api/tenants/${A}/support-sessions/${a.sessionId}/revoke`, { method: 'POST' })).status).toBe(200)
      expect((await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie: a.cookie, session: a.session })).status).toBe(403)

      const b = await openSupport(ctx)
      expect((await ctx.call(SUPER, `/api/platform/support-sessions/${b.sessionId}/end`, { method: 'POST', session: b.session })).status).toBe(200)
      expect((await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie: b.cookie, session: b.session })).status).toBe(403)
    } finally {
      ctx.close()
    }
  })

  it('subject sem membership ou clínica suspensa a meio: corta e revoga a sessão', async () => {
    for (const cut of ['member', 'suspended'] as const) {
      const ctx = testApp()
      try {
        const { cookie, session, sessionId } = await openSupport(ctx)
        if (cut === 'member') revokeMembership(ctx.admin.db, ctx.clock, { tenantId: A, clerkUserId: ATT_A, actorClerkUserId: OWNER_A, allowOwnerTarget: true })
        else ctx.admin.db.run(`UPDATE tenants SET status = 'suspended' WHERE id = ?`, A)
        const res = await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session })
        expect(res.status, cut).toBe(403)
        expect(cleared(res), cut).toBe(true)
        expect(ctx.admin.db.get<{ status: string }>(`SELECT status FROM support_sessions WHERE id = ?`, sessionId)?.status, cut).toBe('revoked')
      } finally {
        ctx.close()
      }
    }
  })
})

describe('overlay de suporte — interruptor de produção', () => {
  it('em produção sem a variável o cookie é ignorado e nada abre; com «true» abre; em staging abre', async () => {
    const ctx = testApp()
    try {
      const { cookie, session } = await openSupport(ctx)
      const prod = { ENVIRONMENT: 'production' }
      const off = await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session, env: prod })
      expect([off.status, (await json(off)).error]).toEqual([403, 'tenant_access_denied'])
      expect((await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session, env: { ...prod, SUPPORT_SESSIONS_ENABLED: 'false' } })).status).toBe(403)
      expect((await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session, env: { ...prod, SUPPORT_SESSIONS_ENABLED: 'true' } })).status).toBe(200)
      expect((await ctx.call(SUPER, `/api/tenants/${A}/context`, { cookie, session, env: { ENVIRONMENT: 'staging' } })).status).toBe(200)
    } finally {
      ctx.close()
    }
  })
})

describe('overlay de suporte — o cookie', () => {
  it('é HttpOnly, SameSite=Strict e só vale em /api; ao limpar mantém os mesmos atributos', async () => {
    const ctx = testApp()
    try {
      const req = createSupportAccessRequest(ctx.admin.db, ctx.clock, { tenantId: A, actorClerkUserId: SUPER, subjectClerkUserId: ATT_A, reason: 'x', scope: 'read_diagnostics' })
      approveSupportRequest(ctx.admin.db, ctx.clock, { requestId: req.id, ownerClerkUserId: OWNER_A })
      const act = await json(await ctx.call(SUPER, `/api/platform/support-requests/${req.id}/activate`, { method: 'POST', session: 's' }))
      const handoff = await ctx.call(SUPER, '/api/support/handoff', { method: 'POST', json: { handoffCode: act.handoffCode }, session: 's' })
      const set = handoff.headers.get('Set-Cookie') ?? ''
      expect(set).toMatch(/HttpOnly/)
      expect(set).toMatch(/SameSite=Strict/)
      expect(set).toMatch(/Path=\/api(;|$)/)
      const end = await ctx.call(SUPER, `/api/platform/support-sessions/${act.session.id}/end`, { method: 'POST', session: 's' })
      const clear = end.headers.get('Set-Cookie') ?? ''
      expect(clear).toMatch(/Path=\/api/)
      expect(clear).toMatch(/SameSite=Strict/)
      expect(clear).toMatch(/Max-Age=0/)
    } finally {
      ctx.close()
    }
  })
})
