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
import {
  approveSupportRequest,
  createSupportAccessRequest,
  listAuditForTenant,
  SUPPORT_SESSION_TTL_MS,
  revokeMembership,
} from '../db/admin'
import { createControllableClock } from '../db/clock'
import { createSimulatedEmailTransport } from '../email'

const SUPER = 'user_synth_superadmin'
const OWNER_A = 'user_synth_owner_a'
const SUBJECT = 'user_synth_attendant_a'
const T0 = 3_100_000_000_000

type Published = Array<{ type: string; tenantId: string }>

/** App SEM `syncAdminDbFactory`: as rotas de suporte seguem o caminho assíncrono (o mesmo SQL do D1). */
function testApp() {
  const boot = bootAdminDb()
  const clock = createControllableClock(T0)
  const transport = createSimulatedEmailTransport({ clock })
  const published: Published = []
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(boot.db),
    verifiedEmails: createSyntheticVerifiedEmailReader(),
    staffProfiles: createSyntheticStaffProfileReader(),
  }
  const app = createApp({
    authServicesFactory: () => services,
    supportAsyncDbFactory: () => asyncFromSync(boot.db),
    clockFactory: () => clock,
    emailFactory: () => transport,
    appBaseUrl: undefined as never,
    appBaseUrlFactory: () => 'http://localhost:5173',
    eventPublisherFactory: () => ({
      async publishTenantEvent(e) {
        published.push({ type: e.type, tenantId: e.tenantId })
        return { ok: true, seq: published.length, delivered: [], revoked: [] }
      },
    }),
  } as Parameters<typeof createApp>[0])
  const call = (user: string, path: string, init: { method?: string; json?: unknown; session?: string; cookie?: string; env?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { Authorization: synthAuthHeader(user), Origin: 'http://localhost:5173' }
    if (init.session) headers['X-Synth-Session'] = init.session
    if (init.cookie) headers.Cookie = init.cookie
    if (init.json !== undefined) headers['Content-Type'] = 'application/json'
    return app.request(
      `http://localhost${path}`,
      { method: init.method ?? 'GET', headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined },
      init.env as never,
    )
  }
  /** Pedido criado e aprovado direto no store (a criação por D1 puro tem os seus testes). */
  const approvedRequest = (over: { actor?: string; subject?: string; tenantId?: string } = {}) => {
    const req = createSupportAccessRequest(boot.db, clock, {
      tenantId: over.tenantId ?? 'clinic-demo-a',
      actorClerkUserId: over.actor ?? SUPER,
      subjectClerkUserId: over.subject ?? SUBJECT,
      reason: 'diagnóstico',
      scope: 'read_diagnostics',
    })
    approveSupportRequest(boot.db, clock, { requestId: req.id, ownerClerkUserId: OWNER_A })
    return req.id
  }
  const pendingRequest = () =>
    createSupportAccessRequest(boot.db, clock, {
      tenantId: 'clinic-demo-a',
      actorClerkUserId: SUPER,
      subjectClerkUserId: SUBJECT,
      reason: 'pendente',
      scope: 'read_diagnostics',
    }).id
  return { boot, clock, transport, published, call, approvedRequest, pendingRequest, close: boot.close }
}
type Ctx = ReturnType<typeof testApp>

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Json
const activate = (ctx: Ctx, id: string, session = 'sess_a') =>
  ctx.call(SUPER, `/api/platform/support-requests/${id}/activate`, { method: 'POST', session })
const cookieOf = (res: Response) => /tredane_support=([^;]+)/.exec(res.headers.get('Set-Cookie') ?? '')?.[1]
async function activeSession(ctx: Ctx, session = 'sess_a') {
  const act = await json(await activate(ctx, ctx.approvedRequest(), session))
  const handoff = await ctx.call(SUPER, '/api/support/handoff', { method: 'POST', json: { handoffCode: act.handoffCode }, session })
  expect(handoff.status).toBe(200)
  return { sessionId: act.session.id as string, cookie: `tredane_support=${cookieOf(handoff)}`, handoffCode: act.handoffCode as string }
}

describe('HTTP — ciclo da sessão de suporte no caminho assíncrono (D1), #853', () => {
  it('ativar: sessão de 30 min, handoff de uso único, e-mail às owners e evento em tempo real', async () => {
    const ctx = testApp()
    try {
      const res = await activate(ctx, ctx.approvedRequest())
      expect(res.status).toBe(201)
      const body = await json(res)
      expect(body.session).toMatchObject({ status: 'active', tenantId: 'clinic-demo-a', actorClerkUserId: SUPER, subjectClerkUserId: SUBJECT })
      expect(body.session.expiresAt - body.session.activatedAt).toBe(SUPPORT_SESSION_TTL_MS)
      expect(body.handoffCode.length).toBeGreaterThan(20)
      expect(body.accessGranted).toBe(false)
      expect(body.emailsQueued).toBeGreaterThanOrEqual(1)
      expect(ctx.transport.mailbox.some((m) => m.template === 'support_session_started')).toBe(true)
      expect(ctx.published.map((p) => p.type)).toContain('support.session.started')
      // O handoff e o token nunca vão para o e-mail nem para a resposta de listagem nem para a auditoria.
      const everything = JSON.stringify(ctx.transport.mailbox) + JSON.stringify(listAuditForTenant(ctx.boot.db, 'clinic-demo-a', { limit: 50 }))
      expect(everything).not.toContain(body.handoffCode)
      expect(JSON.stringify(body.session)).not.toMatch(/token|handoff/i)
      const audit = listAuditForTenant(ctx.boot.db, 'clinic-demo-a', { limit: 50 }).find((e) => e.action === 'support.session.activate')
      expect(audit).toMatchObject({ actorClerkUserId: SUPER, subjectClerkUserId: SUBJECT, supportSessionId: body.session.id })
    } finally {
      ctx.close()
    }
  })

  it('ativar recusa: pendente, já ativada, outro actor, pedido inexistente, subject sem membership, clínica suspensa', async () => {
    const ctx = testApp()
    try {
      const code = async (res: Response) => [res.status, (await json(res)).error]
      expect(await code(await activate(ctx, ctx.pendingRequest()))).toEqual([409, 'support_request_not_approved'])
      expect(await code(await activate(ctx, 'sar_nao_existe'))).toEqual([404, 'support_request_not_found'])
      expect(await code(await activate(ctx, ctx.approvedRequest({ actor: 'user_outro_actor' })))).toEqual([403, 'not_request_actor'])

      const ok = ctx.approvedRequest()
      expect((await activate(ctx, ok)).status).toBe(201)
      expect(await code(await activate(ctx, ok))).toEqual([409, 'support_session_already_active'])

      const gone = ctx.approvedRequest({ subject: 'user_synth_multi' })
      revokeMembership(ctx.boot.db, ctx.clock, { tenantId: 'clinic-demo-a', clerkUserId: 'user_synth_multi', actorClerkUserId: OWNER_A, allowOwnerTarget: true })
      expect(await code(await activate(ctx, gone))).toEqual([403, 'subject_not_member'])

      const susp = ctx.approvedRequest()
      ctx.boot.db.run(`UPDATE tenants SET status = 'suspended' WHERE id = 'clinic-demo-a'`)
      expect(await code(await activate(ctx, susp))).toEqual([403, 'tenant_not_active'])
      expect(ctx.published.filter((p) => p.type === 'support.session.started')).toHaveLength(1)
    } finally {
      ctx.close()
    }
  })

  it('handoff: troca uma vez por um cookie HttpOnly; o replay e o consumo concorrente falham', async () => {
    const ctx = testApp()
    try {
      const act = await json(await activate(ctx, ctx.approvedRequest()))
      const exchange = () => ctx.call(SUPER, '/api/support/handoff', { method: 'POST', json: { handoffCode: act.handoffCode }, session: 'sess_a' })
      const results = await Promise.all([exchange(), exchange()])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
      const ok = results.find((r) => r.status === 200)!
      expect(ok.headers.get('Set-Cookie')).toMatch(/HttpOnly/)
      expect(ok.headers.get('Set-Cookie')).toMatch(/tredane_support=/)
      expect(await json(ok)).toMatchObject({ accessGranted: true, cookie: 'tredane_support' })
      const replay = await exchange()
      expect(replay.status).toBe(409)
      expect((await json(replay)).error).toBe('handoff_invalid')
    } finally {
      ctx.close()
    }
  })

  it('handoff: sessão Clerk diferente, tenant ou subject forjados e outro actor são recusados sem consumir o código', async () => {
    const ctx = testApp()
    try {
      const act = await json(await activate(ctx, ctx.approvedRequest()))
      const exchange = (extra: Record<string, unknown>, session = 'sess_a', user = SUPER) =>
        ctx.call(user, '/api/support/handoff', { method: 'POST', json: { handoffCode: act.handoffCode, ...extra }, session })
      const other = await exchange({}, 'sess_outra')
      expect([other.status, (await json(other)).error]).toEqual([403, 'handoff_clerk_session_mismatch'])
      const tenant = await exchange({ tenantId: 'clinic-demo-b' })
      expect([tenant.status, (await json(tenant)).error]).toEqual([403, 'support_tenant_forged'])
      const subject = await exchange({ subjectClerkUserId: 'user_synth_owner_a' })
      expect([subject.status, (await json(subject)).error]).toEqual([403, 'support_subject_forged'])
      // Nenhuma das tentativas gastou o código: a troca legítima ainda funciona.
      expect((await exchange({})).status).toBe(200)
    } finally {
      ctx.close()
    }
  })

  it('handoff com a sessão já expirada dá 409 e marca-a como expirada', async () => {
    const ctx = testApp()
    try {
      const act = await json(await activate(ctx, ctx.approvedRequest()))
      ctx.clock.advance(SUPPORT_SESSION_TTL_MS + 1)
      const res = await ctx.call(SUPER, '/api/support/handoff', { method: 'POST', json: { handoffCode: act.handoffCode }, session: 'sess_a' })
      expect([res.status, (await json(res)).error]).toEqual([409, 'support_session_expired'])
      const status = ctx.boot.db.get<{ status: string }>(`SELECT status FROM support_sessions WHERE id = ?`, act.session.id)
      expect(status?.status).toBe('expired')
    } finally {
      ctx.close()
    }
  })

  it('ler a sessão pelo cookie: ativa com o tempo que resta, sem renovar o prazo', async () => {
    const ctx = testApp()
    try {
      const { cookie, sessionId } = await activeSession(ctx)
      ctx.clock.advance(10 * 60_000)
      const res = await ctx.call(SUPER, '/api/support/session', { cookie, session: 'sess_a' })
      expect(res.status).toBe(200)
      const body = await json(res)
      expect(body).toMatchObject({ active: true, ttlRemainingMs: SUPPORT_SESSION_TTL_MS - 10 * 60_000 })
      expect(body.session.id).toBe(sessionId)
      // Usar a sessão várias vezes não alarga o prazo (DEC-033).
      ctx.clock.advance(5 * 60_000)
      const again = await json(await ctx.call(SUPER, '/api/support/session', { cookie, session: 'sess_a' }))
      expect(again.ttlRemainingMs).toBe(SUPPORT_SESSION_TTL_MS - 15 * 60_000)
      expect((await ctx.call(SUPER, '/api/support/session/extend', { method: 'POST', cookie })).status).toBe(405)
      // Sem cookie: nada ativo.
      expect(await json(await ctx.call(SUPER, '/api/support/session', { session: 'sess_a' }))).toEqual({ active: false, session: null })
    } finally {
      ctx.close()
    }
  })

  it('o cookie só vale para o mesmo actor, a mesma sessão Clerk e o tenant certo', async () => {
    const ctx = testApp()
    try {
      const { cookie } = await activeSession(ctx)
      const status = async (path: string, opts: Parameters<Ctx['call']>[2]) => (await ctx.call(SUPER, path, opts)).status
      expect(await status('/api/support/session', { cookie, session: 'sess_outra' })).toBe(403)
      expect(await status('/api/support/session?tenantId=clinic-demo-b', { cookie, session: 'sess_a' })).toBe(403)
      expect(await status('/api/support/session?subjectClerkUserId=user_synth_owner_a', { cookie, session: 'sess_a' })).toBe(403)
      expect(await status('/api/support/session', { cookie: 'tredane_support=lixo', session: 'sess_a' })).toBe(403)
      // Outro utilizador com o mesmo cookie não entra.
      expect((await ctx.call(OWNER_A, '/api/support/session', { cookie, session: 'sess_a' })).status).toBe(403)
    } finally {
      ctx.close()
    }
  })

  it('expiração, membership revogado e clínica suspensa cortam a sessão e limpam o cookie', async () => {
    for (const cut of ['expired', 'member', 'suspended'] as const) {
      const ctx = testApp()
      try {
        const { cookie, sessionId } = await activeSession(ctx)
        if (cut === 'expired') ctx.clock.advance(SUPPORT_SESSION_TTL_MS + 1)
        if (cut === 'member') revokeMembership(ctx.boot.db, ctx.clock, { tenantId: 'clinic-demo-a', clerkUserId: SUBJECT, actorClerkUserId: OWNER_A, allowOwnerTarget: true })
        if (cut === 'suspended') ctx.boot.db.run(`UPDATE tenants SET status = 'suspended' WHERE id = 'clinic-demo-a'`)
        const res = await ctx.call(SUPER, '/api/support/session', { cookie, session: 'sess_a' })
        expect(res.status, cut).toBe(403)
        expect(res.headers.get('Set-Cookie') ?? '', cut).toMatch(/tredane_support=;/)
        const row = ctx.boot.db.get<{ status: string }>(`SELECT status FROM support_sessions WHERE id = ?`, sessionId)
        expect(row?.status, cut).not.toBe('active')
        // E não volta a abrir.
        expect((await ctx.call(SUPER, '/api/support/session', { cookie, session: 'sess_a' })).status, cut).toBe(403)
      } finally {
        ctx.close()
      }
    }
  })

  it('o actor encerra a sua sessão: revogada, cookie limpo, evento e nenhum e-mail de fim (DEC-035)', async () => {
    const ctx = testApp()
    try {
      const { cookie, sessionId } = await activeSession(ctx)
      const mailBefore = ctx.transport.mailbox.length
      ctx.clock.advance(7 * 60_000)
      const res = await ctx.call(SUPER, `/api/platform/support-sessions/${sessionId}/end`, { method: 'POST', session: 'sess_a' })
      expect(res.status).toBe(200)
      expect(res.headers.get('Set-Cookie') ?? '').toMatch(/tredane_support=;/)
      const body = await json(res)
      expect(body).toMatchObject({ session: { status: 'revoked' }, endEmailsSent: 0, clerkSessionPreserved: true })
      expect(ctx.transport.mailbox).toHaveLength(mailBefore)
      expect(ctx.published.map((p) => p.type)).toContain('support.session.ended')
      expect((await ctx.call(SUPER, '/api/support/session', { cookie, session: 'sess_a' })).status).toBe(403)
      // Encerrar duas vezes é um conflito, não um erro 500.
      expect((await ctx.call(SUPER, `/api/platform/support-sessions/${sessionId}/end`, { method: 'POST', session: 'sess_a' })).status).toBe(409)
    } finally {
      ctx.close()
    }
  })

  it('só o actor da sessão a encerra pela rota da plataforma', async () => {
    const ctx = testApp()
    try {
      const { sessionId } = await activeSession(ctx)
      // O superadmin é o único actor sintético: forço outro actor na linha para provar a regra.
      ctx.boot.db.run(`UPDATE support_sessions SET actor_clerk_user_id = 'user_outro_actor' WHERE id = ?`, sessionId)
      const res = await ctx.call(SUPER, `/api/platform/support-sessions/${sessionId}/end`, { method: 'POST', session: 'sess_a' })
      expect([res.status, (await json(res)).error]).toEqual([403, 'not_session_actor'])
    } finally {
      ctx.close()
    }
  })

  it('a owner da clínica revoga; owner de outra clínica não; e a sessão não se revoga pela rota de outra clínica', async () => {
    const ctx = testApp()
    try {
      const { sessionId } = await activeSession(ctx)
      const revoke = (user: string, tenant: string) =>
        ctx.call(user, `/api/tenants/${tenant}/support-sessions/${sessionId}/revoke`, { method: 'POST' })
      const otherOwner = await revoke('user_synth_owner_b', 'clinic-demo-b')
      expect([otherOwner.status, (await json(otherOwner)).error]).toEqual([403, 'support_tenant_mismatch'])
      expect((await revoke(SUBJECT, 'clinic-demo-a')).status).toBe(403)
      let row = ctx.boot.db.get<{ status: string }>(`SELECT status FROM support_sessions WHERE id = ?`, sessionId)
      expect(row?.status).toBe('active')

      const ok = await revoke(OWNER_A, 'clinic-demo-a')
      expect(ok.status).toBe(200)
      expect(await json(ok)).toMatchObject({ session: { status: 'revoked' }, endEmailsSent: 0 })
      row = ctx.boot.db.get<{ status: string; revoked_by_clerk_user_id: string }>(`SELECT status, revoked_by_clerk_user_id FROM support_sessions WHERE id = ?`, sessionId)
      expect(row).toMatchObject({ status: 'revoked', revoked_by_clerk_user_id: OWNER_A })
    } finally {
      ctx.close()
    }
  })

  it('revogar fecha o pedido de fim a pedido do subject que estava pendente', async () => {
    const ctx = testApp()
    try {
      const { sessionId } = await activeSession(ctx)
      ctx.boot.db.run(
        `INSERT INTO support_termination_requests (id, support_session_id, tenant_id, requested_by_subject_clerk_user_id, requested_at, status)
         VALUES ('str_1', ?, 'clinic-demo-a', ?, ?, 'pending')`,
        sessionId,
        SUBJECT,
        T0,
      )
      await ctx.call(OWNER_A, `/api/tenants/clinic-demo-a/support-sessions/${sessionId}/revoke`, { method: 'POST' })
      const t = ctx.boot.db.get<{ status: string }>(`SELECT status FROM support_termination_requests WHERE id = 'str_1'`)
      expect(t?.status).toBe('closed_with_session')
    } finally {
      ctx.close()
    }
  })

  it('cancelar pedido: pendente e aprovado-por-ativar cancelam; depois da ativação ou de outro actor não', async () => {
    const ctx = testApp()
    try {
      const cancel = (id: string, user = SUPER) => ctx.call(user, `/api/platform/support-requests/${id}/cancel`, { method: 'POST' })
      const p = ctx.pendingRequest()
      const res = await cancel(p)
      expect(res.status).toBe(200)
      expect((await json(res)).request.status).toBe('cancelled')
      expect(listAuditForTenant(ctx.boot.db, 'clinic-demo-a', { limit: 50 }).some((e) => e.action === 'support.request.cancel' && e.objectId === p)).toBe(true)
      expect((await cancel(p)).status).toBe(409)

      const a = ctx.approvedRequest()
      expect((await cancel(a)).status).toBe(200)
      // Cancelado não se ativa.
      expect([(await activate(ctx, a)).status]).toEqual([409])

      const live = ctx.approvedRequest()
      await activate(ctx, live)
      const late = await cancel(live)
      expect([late.status, (await json(late)).error]).toEqual([409, 'support_request_not_cancellable'])

      const other = ctx.pendingRequest()
      ctx.boot.db.run(`UPDATE support_access_requests SET actor_clerk_user_id = 'user_outro_actor' WHERE id = ?`, other)
      expect((await cancel(other)).status).toBe(403)
      expect((await cancel('sar_nao_existe')).status).toBe(404)
      expect((await cancel(ctx.pendingRequest(), OWNER_A)).status).toBe(403)
    } finally {
      ctx.close()
    }
  })

  it('interruptor: em produção ativar e trocar o handoff ficam desligados; staging e o valor «true» ligam', async () => {
    const ctx = testApp()
    try {
      const prod = { ENVIRONMENT: 'production' }
      const a = await ctx.call(SUPER, `/api/platform/support-requests/${ctx.approvedRequest()}/activate`, { method: 'POST', session: 'sess_a', env: prod })
      expect([a.status, (await json(a)).error]).toEqual([404, 'support_sessions_disabled'])
      const h = await ctx.call(SUPER, '/api/support/handoff', { method: 'POST', json: { handoffCode: 'x' }, session: 'sess_a', env: prod })
      expect([h.status, (await json(h)).error]).toEqual([404, 'support_sessions_disabled'])
      const off = await ctx.call(SUPER, `/api/platform/support-requests/${ctx.approvedRequest()}/activate`, { method: 'POST', session: 'sess_a', env: { ...prod, SUPPORT_SESSIONS_ENABLED: 'false' } })
      expect(off.status).toBe(404)
      // Nada ficou gravado pelas tentativas desligadas.
      const n = ctx.boot.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM support_sessions`)
      expect(Number(n?.n)).toBe(0)
      const on = await ctx.call(SUPER, `/api/platform/support-requests/${ctx.approvedRequest()}/activate`, { method: 'POST', session: 'sess_a', env: { ...prod, SUPPORT_SESSIONS_ENABLED: 'true' } })
      expect(on.status).toBe(201)
      const staging = await ctx.call(SUPER, `/api/platform/support-requests/${ctx.approvedRequest()}/activate`, { method: 'POST', session: 'sess_a', env: { ENVIRONMENT: 'staging' } })
      expect(staging.status).toBe(201)
    } finally {
      ctx.close()
    }
  })

  it('só o superadmin: owners e flags não booleanas recebem 403 e nada é ativado', async () => {
    const ctx = testApp()
    try {
      const id = ctx.approvedRequest()
      for (const user of [OWNER_A, 'user_synth_string_super', 'user_synth_public_super']) {
        for (const [path, method, body] of [
          [`/api/platform/support-requests/${id}/activate`, 'POST', undefined],
          [`/api/platform/support-requests/${id}/cancel`, 'POST', undefined],
          ['/api/support/handoff', 'POST', { handoffCode: 'x' }],
          ['/api/support/session', 'GET', undefined],
        ] as const) {
          const res = await ctx.call(user, path, { method, json: body })
          expect(res.status, `${user} ${path}`).toBe(403)
        }
      }
      expect(Number(ctx.boot.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM support_sessions`)?.n)).toBe(0)
    } finally {
      ctx.close()
    }
  })
})
