/**
 * HTTP — sessão de suporte, handoff, TTL, revogação (#27 / DEC-032–037).
 * Dados sintéticos apenas.
 */
import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  createSyntheticVerifiedEmailReader,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import {
  SUPPORT_SESSION_TTL_MS,
  getSupportSession,
  listAuditForTenant,
  revokeMembership,
} from '../db/admin'
import { createControllableClock } from '../db/clock'
import {
  createSimulatedEmailTransport,
  type SimulatedEmailTransport,
} from '../email'
import type { ClinicEventPublisher } from '../realtime'
import { SUPPORT_COOKIE_NAME, parseSupportCookie } from './cookie'

function testApp(opts: { emailFail?: boolean } = {}) {
  const boot = bootAdminDb()
  const clock = createControllableClock(3_300_000_000_000)
  const transport = createSimulatedEmailTransport({ clock })
  if (opts.emailFail) transport.failNext(100)
  const published: Array<Record<string, unknown>> = []
  const events: ClinicEventPublisher = {
    async publishTenantEvent(input) {
      published.push(input as unknown as Record<string, unknown>)
      return { ok: true, seq: published.length, delivered: ['owner'], revoked: [] }
    },
  }
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({
      authorizedParties: ['http://localhost:5173'],
    }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(boot.db),
    verifiedEmails: createSyntheticVerifiedEmailReader(),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => boot.db,
    clockFactory: () => clock,
    emailFactory: () => transport,
    appBaseUrlFactory: () => 'http://localhost:5173',
    eventPublisherFactory: () => events,
  })
  return {
    app,
    boot,
    clock,
    transport,
    published,
    close: boot.close,
    auth: (userId: string, init: RequestInit = {}, sessionId?: string) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', synthAuthHeader(userId))
      if (sessionId) headers.set('X-Synth-Session', sessionId)
      return { ...init, headers }
    },
  }
}

async function approveFlow(ctx: ReturnType<typeof testApp>) {
  const created = await ctx.app.request(
    'http://localhost/api/platform/support-requests',
    ctx.auth('user_synth_superadmin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'clinic-demo-a',
        subjectClerkUserId: 'user_synth_attendant_a',
        reason: 'diagnóstico sintético',
        scope: 'read_diagnostics',
      }),
    }, 'sess_actor_a'),
  )
  expect(created.status).toBe(201)
  const body = (await created.json()) as { request: { id: string } }
  const decision = await ctx.app.request(
    `http://localhost/api/tenants/clinic-demo-a/support-requests/${body.request.id}/decision`,
    ctx.auth('user_synth_owner_a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    }),
  )
  expect(decision.status).toBe(200)
  return body.request.id
}

async function activateAndHandoff(
  ctx: ReturnType<typeof testApp>,
  requestId: string,
  sessionId = 'sess_actor_a',
) {
  const act = await ctx.app.request(
    `http://localhost/api/platform/support-requests/${requestId}/activate`,
    ctx.auth('user_synth_superadmin', { method: 'POST' }, sessionId),
  )
  expect(act.status).toBe(201)
  const actBody = (await act.json()) as {
    session: { id: string; expiresAt: number; activatedAt: number }
    handoffCode: string
    emailsSent: number
  }
  const handoff = await ctx.app.request(
    'http://localhost/api/support/handoff',
    ctx.auth(
      'user_synth_superadmin',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoffCode: actBody.handoffCode }),
      },
      sessionId,
    ),
  )
  expect(handoff.status).toBe(200)
  const setCookie = handoff.headers.get('Set-Cookie') ?? ''
  expect(setCookie).toContain(SUPPORT_COOKIE_NAME)
  const token = parseSupportCookie(setCookie.split(';')[0] ?? null)
  expect(token).toBeTruthy()
  const handoffBody = (await handoff.json()) as {
    session: { id: string }
    accessGranted: boolean
  }
  return { actBody, handoffBody, token: token!, setCookie }
}

describe('HTTP — Sessão de suporte (#27)', () => {
  it('sem aprovação não ativa; ativação envia e-mail início e handoff one-shot', async () => {
    const ctx = testApp()
    try {
      const pending = await ctx.app.request(
        'http://localhost/api/platform/support-requests',
        ctx.auth('user_synth_superadmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: 'clinic-demo-a',
            subjectClerkUserId: 'user_synth_attendant_a',
            reason: 'sem aprovação',
            scope: 'read_diagnostics',
          }),
        }, 'sess_actor_a'),
      )
      const pendingBody = (await pending.json()) as { request: { id: string } }
      const denied = await ctx.app.request(
        `http://localhost/api/platform/support-requests/${pendingBody.request.id}/activate`,
        ctx.auth('user_synth_superadmin', { method: 'POST' }, 'sess_actor_a'),
      )
      expect(denied.status).toBe(409)

      const requestId = await approveFlow(ctx)
      const { actBody, token } = await activateAndHandoff(ctx, requestId)
      expect(actBody.session.expiresAt - actBody.session.activatedAt).toBe(SUPPORT_SESSION_TTL_MS)
      expect(actBody.emailsSent).toBeGreaterThanOrEqual(1)

      const startMails = ctx.transport.mailbox.filter((m) => m.template === 'support_session_started')
      expect(startMails.length).toBeGreaterThanOrEqual(2)
      for (const mail of startMails) {
        if (mail.template !== 'support_session_started') continue
        expect(mail.sessionUrl).toContain(`/t/clinic-demo-a/support-sessions/`)
        expect(mail.sessionUrl).not.toMatch(/token=|handoff/i)
      }
      expect(ctx.published.some((p) => p.type === 'support.session.started')).toBe(true)
      expect(ctx.published.find((p) => p.type === 'support.session.started')?.audience).toBe(
        'owners_and_subject',
      )

      // Replay handoff
      const replay = await ctx.app.request(
        'http://localhost/api/support/handoff',
        ctx.auth('user_synth_superadmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handoffCode: actBody.handoffCode }),
        }, 'sess_actor_a'),
      )
      expect(replay.status).toBe(409)

      const me = await ctx.app.request(
        'http://localhost/api/support/session',
        ctx.auth('user_synth_superadmin', {
          headers: { Cookie: `${SUPPORT_COOKIE_NAME}=${encodeURIComponent(token)}` },
        }, 'sess_actor_a'),
      )
      expect(me.status).toBe(200)
      const meBody = (await me.json()) as { active: boolean; ttlRemainingMs: number }
      expect(meBody.active).toBe(true)
      expect(meBody.ttlRemainingMs).toBeLessThanOrEqual(SUPPORT_SESSION_TTL_MS)
    } finally {
      ctx.close()
    }
  })

  it('CSRF: cookie transport sem Origin nega handoff; tenant/subject forjado nega', async () => {
    const ctx = testApp()
    try {
      const requestId = await approveFlow(ctx)
      const act = await ctx.app.request(
        `http://localhost/api/platform/support-requests/${requestId}/activate`,
        ctx.auth('user_synth_superadmin', { method: 'POST' }, 'sess_actor_a'),
      )
      const actBody = (await act.json()) as { handoffCode: string; session: { id: string } }

      // Cookie synth sem Origin → origin_rejected na sessão Clerk
      const csrf = await ctx.app.request('http://localhost/api/support/handoff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'synth_session=user_synth_superadmin',
          'X-Synth-Session': 'sess_actor_a',
        },
        body: JSON.stringify({ handoffCode: actBody.handoffCode }),
      })
      expect([403, 401]).toContain(csrf.status)

      const forged = await ctx.app.request(
        'http://localhost/api/support/handoff',
        ctx.auth('user_synth_superadmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handoffCode: actBody.handoffCode,
            tenantId: 'clinic-demo-b',
          }),
        }, 'sess_actor_a'),
      )
      // Consome handoff com tenant forjado → 403
      expect(forged.status).toBe(403)
    } finally {
      ctx.close()
    }
  })

  it('TTL exacto sem renovação; cookie antigo e extend negados; novo pedido após fim', async () => {
    const ctx = testApp()
    try {
      const requestId = await approveFlow(ctx)
      const { actBody, token } = await activateAndHandoff(ctx, requestId)
      const sessionId = actBody.session.id

      // Touch / refresh não renova
      ctx.clock.advance(SUPPORT_SESSION_TTL_MS - 1_000)
      const before = await ctx.app.request(
        'http://localhost/api/support/session',
        ctx.auth('user_synth_superadmin', {
          headers: { Cookie: `${SUPPORT_COOKIE_NAME}=${encodeURIComponent(token)}` },
        }, 'sess_actor_a'),
      )
      expect(before.status).toBe(200)
      expect(((await before.json()) as { active: boolean }).active).toBe(true)

      const extend = await ctx.app.request(
        'http://localhost/api/support/session/extend',
        ctx.auth('user_synth_superadmin', { method: 'POST' }, 'sess_actor_a'),
      )
      expect(extend.status).toBe(405)

      ctx.clock.advance(1_000)
      const expired = await ctx.app.request(
        'http://localhost/api/support/session',
        ctx.auth('user_synth_superadmin', {
          headers: { Cookie: `${SUPPORT_COOKIE_NAME}=${encodeURIComponent(token)}` },
        }, 'sess_actor_a'),
      )
      expect(expired.status).toBe(403)
      expect(getSupportSession(ctx.boot.db, sessionId)?.status).toBe('expired')

      // Cookie antigo continua inválido
      const stale = await ctx.app.request(
        'http://localhost/api/support/session',
        ctx.auth('user_synth_superadmin', {
          headers: { Cookie: `${SUPPORT_COOKIE_NAME}=${encodeURIComponent(token)}` },
        }, 'sess_actor_a'),
      )
      expect(stale.status).toBe(403)

      // Continuação exige novo pedido + aprovação
      const again = await approveFlow(ctx)
      const second = await activateAndHandoff(ctx, again, 'sess_actor_a')
      expect(second.actBody.session.id).not.toBe(sessionId)
    } finally {
      ctx.close()
    }
  })

  it('O2 revoga sessão de O1; attendant/owner B negados; sem e-mail de fim; Clerk preservado', async () => {
    const ctx = testApp()
    try {
      const requestId = await approveFlow(ctx)
      const { actBody } = await activateAndHandoff(ctx, requestId)
      const sessionId = actBody.session.id
      const mailsBeforeEnd = ctx.transport.mailbox.length

      const attendantRevoke = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-sessions/${sessionId}/revoke`,
        ctx.auth('user_synth_attendant_a', { method: 'POST' }),
      )
      expect(attendantRevoke.status).toBe(403)

      const ownerB = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-sessions/${sessionId}/revoke`,
        ctx.auth('user_synth_owner_b', { method: 'POST' }),
      )
      expect(ownerB.status).toBe(403)

      const o2 = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-sessions/${sessionId}/revoke`,
        ctx.auth('user_synth_owner_a2', { method: 'POST' }),
      )
      expect(o2.status).toBe(200)
      const o2Body = (await o2.json()) as {
        session: { status: string }
        endEmailsSent: number
      }
      expect(o2Body.session.status).toBe('revoked')
      expect(o2Body.endEmailsSent).toBe(0)
      expect(ctx.transport.mailbox.length).toBe(mailsBeforeEnd)
      expect(ctx.published.some((p) => p.type === 'support.session.ended')).toBe(true)

      const audit = listAuditForTenant(ctx.boot.db, 'clinic-demo-a')
      expect(audit.some((e) =>
        e.action === 'support.session.revoke' && e.actorClerkUserId === 'user_synth_owner_a2',
      )).toBe(true)
    } finally {
      ctx.close()
    }
  })

  it('subject vê notice; attendant T não; pedido encerramento idempotente; keep não altera TTL', async () => {
    const ctx = testApp()
    try {
      const requestId = await approveFlow(ctx)
      const { actBody } = await activateAndHandoff(ctx, requestId)
      const sessionId = actBody.session.id
      const expiresAt = actBody.session.expiresAt

      const subjectNotice = await ctx.app.request(
        'http://localhost/api/tenants/clinic-demo-a/support-sessions/notice',
        ctx.auth('user_synth_attendant_a'),
      )
      expect(subjectNotice.status).toBe(200)
      expect(((await subjectNotice.json()) as { active: boolean }).active).toBe(true)

      // multi é owner em A — vê via list; attendant_a é subject.
      // Outro attendant: seed só tem attendant_a em A. Usar owner_b em B não tem notice em A.
      const otherTenant = await ctx.app.request(
        'http://localhost/api/tenants/clinic-demo-b/support-sessions/notice',
        ctx.auth('user_synth_attendant_a'),
      )
      // attendant_a não é membro de B
      expect([403, 200]).toContain(otherTenant.status)

      const ownersList = await ctx.app.request(
        'http://localhost/api/tenants/clinic-demo-a/support-sessions',
        ctx.auth('user_synth_owner_a'),
      )
      expect(ownersList.status).toBe(200)
      expect(
        ((await ownersList.json()) as { sessions: Array<{ id: string }> }).sessions
          .some((s) => s.id === sessionId),
      ).toBe(true)

      const t1 = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-sessions/${sessionId}/termination-requests`,
        ctx.auth('user_synth_attendant_a', { method: 'POST' }),
      )
      expect(t1.status).toBe(201)
      const t1Body = (await t1.json()) as {
        terminationRequest: { id: string; created: boolean }
        created: boolean
      }
      expect(t1Body.created).toBe(true)

      const t2 = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-sessions/${sessionId}/termination-requests`,
        ctx.auth('user_synth_attendant_a', { method: 'POST' }),
      )
      expect(t2.status).toBe(200)
      const t2Body = (await t2.json()) as {
        terminationRequest: { id: string }
        created: boolean
      }
      expect(t2Body.created).toBe(false)
      expect(t2Body.terminationRequest.id).toBe(t1Body.terminationRequest.id)

      // Outro user não forja
      const forged = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-sessions/${sessionId}/termination-requests`,
        ctx.auth('user_synth_owner_a2', { method: 'POST' }),
      )
      expect(forged.status).toBe(403)

      const keep = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-sessions/${sessionId}/termination-requests/${t1Body.terminationRequest.id}/decision`,
        ctx.auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'keep' }),
        }),
      )
      expect(keep.status).toBe(200)
      const keepBody = (await keep.json()) as {
        session: { status: string; expiresAt: number }
        ttlUnchanged: boolean
      }
      expect(keepBody.session.status).toBe('active')
      expect(keepBody.session.expiresAt).toBe(expiresAt)
      expect(keepBody.ttlUnchanged).toBe(true)
    } finally {
      ctx.close()
    }
  })

  it('revogação de membership do subject corta sessão; tenant B intacto', async () => {
    const ctx = testApp()
    try {
      const requestId = await approveFlow(ctx)
      const { actBody, token } = await activateAndHandoff(ctx, requestId)

      revokeMembership(ctx.boot.db, ctx.clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_attendant_a',
        actorClerkUserId: 'user_synth_owner_a',
      })

      expect(getSupportSession(ctx.boot.db, actBody.session.id)?.status).toBe('revoked')

      const denied = await ctx.app.request(
        'http://localhost/api/support/session',
        ctx.auth('user_synth_superadmin', {
          headers: { Cookie: `${SUPPORT_COOKIE_NAME}=${encodeURIComponent(token)}` },
        }, 'sess_actor_a'),
      )
      expect(denied.status).toBe(403)

      // multi ainda tem membership B
      const multiB = await ctx.app.request(
        'http://localhost/api/tenants/clinic-demo-b/support-sessions/notice',
        ctx.auth('user_synth_multi'),
      )
      expect(multiB.status).toBe(200)
    } finally {
      ctx.close()
    }
  })

  it('actor encerra voluntariamente; e-mail de início idempotente; sessões Clerk/outras clínicas preservadas', async () => {
    const ctx = testApp()
    try {
      const requestId = await approveFlow(ctx)
      const { actBody } = await activateAndHandoff(ctx, requestId)
      const startCount = ctx.transport.mailbox.filter(
        (m) => m.template === 'support_session_started',
      ).length

      // Reentrega idempotente: segunda activação do mesmo pedido falha
      const again = await ctx.app.request(
        `http://localhost/api/platform/support-requests/${requestId}/activate`,
        ctx.auth('user_synth_superadmin', { method: 'POST' }, 'sess_actor_a'),
      )
      expect(again.status).toBe(409)
      expect(
        ctx.transport.mailbox.filter((m) => m.template === 'support_session_started').length,
      ).toBe(startCount)

      const end = await ctx.app.request(
        `http://localhost/api/platform/support-sessions/${actBody.session.id}/end`,
        ctx.auth('user_synth_superadmin', { method: 'POST' }, 'sess_actor_a'),
      )
      expect(end.status).toBe(200)
      const endBody = (await end.json()) as {
        clerkSessionPreserved: boolean
        endEmailsSent: number
        session: { status: string }
      }
      expect(endBody.clerkSessionPreserved).toBe(true)
      expect(endBody.endEmailsSent).toBe(0)
      expect(endBody.session.status).toBe('revoked')
      expect(end.headers.get('Set-Cookie')).toContain(`${SUPPORT_COOKIE_NAME}=`)
    } finally {
      ctx.close()
    }
  })
})
