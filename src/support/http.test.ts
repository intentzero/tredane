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
  SUPPORT_REQUEST_TTL_MS,
  getSupportRequest,
  listAuditForTenant,
  revokeMembership,
} from '../db/admin'
import { createControllableClock } from '../db/clock'
import {
  createSimulatedEmailTransport,
  type SimulatedEmailTransport,
} from '../email'
import type { ClinicEventPublisher } from '../realtime'

function testSupportApp(opts: {
  emailFail?: boolean
  events?: ClinicEventPublisher
} = {}) {
  const boot = bootAdminDb()
  const clock = createControllableClock(3_200_000_000_000)
  const transport = createSimulatedEmailTransport({ clock })
  if (opts.emailFail) transport.failNext(100)
  const published: Array<Record<string, unknown>> = []
  const events: ClinicEventPublisher = opts.events ?? {
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
    auth: (userId: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', synthAuthHeader(userId))
      return { ...init, headers }
    },
  }
}

async function createRequest(
  ctx: ReturnType<typeof testSupportApp>,
  body: Record<string, string> = {},
) {
  return ctx.app.request(
    'http://localhost/api/platform/support-requests',
    ctx.auth('user_synth_superadmin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'clinic-demo-a',
        subjectClerkUserId: 'user_synth_attendant_a',
        reason: 'diagnóstico sintético',
        scope: 'read_diagnostics',
        ...body,
      }),
    }),
  )
}

describe('HTTP — Pedidos de suporte e aprovação (#26)', () => {
  it('superadmin cria pending sem sessão/handoff; owners A recebem e-mail com link sem credencial', async () => {
    const ctx = testSupportApp()
    try {
      const res = await createRequest(ctx)
      expect(res.status).toBe(201)
      const body = (await res.json()) as {
        request: { id: string; status: string; expiresAt: number; createdAt: number }
        emailsSent: number
        accessGranted: boolean
      }
      expect(body.request.status).toBe('pending')
      expect(body.accessGranted).toBe(false)
      expect(body.request.expiresAt - body.request.createdAt).toBe(SUPPORT_REQUEST_TTL_MS)
      expect(JSON.stringify(body)).not.toMatch(/handoff|sessionToken|token/i)

      const sessions = ctx.boot.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM support_sessions WHERE support_access_request_id = ?`,
        body.request.id,
      )
      expect(sessions?.n).toBe(0)

      const supportMails = ctx.transport.mailbox.filter(
        (m) => m.template === 'support_access_request',
      )
      expect(supportMails.length).toBeGreaterThanOrEqual(2)
      for (const mail of supportMails) {
        if (mail.template !== 'support_access_request') continue
        expect(mail.requestUrl).toContain(`/t/clinic-demo-a/support-requests/${body.request.id}`)
        expect(mail.requestUrl).not.toMatch(/token=|handoff/i)
      }

      expect(ctx.published.some((p) => p.type === 'support.request.created')).toBe(true)
      expect(ctx.published[0]?.audience).toBe('owners')
    } finally {
      ctx.close()
    }
  })

  it('pedido funciona com e-mail indisponível; owner aprova/rejeita; aprovado sem sessão', async () => {
    const ctx = testSupportApp({ emailFail: true })
    try {
      const created = await createRequest(ctx)
      expect(created.status).toBe(201)
      const createdBody = (await created.json()) as {
        request: { id: string }
        emailsSent: number
      }
      expect(createdBody.emailsSent).toBe(0)

      const list = await ctx.app.request(
        'http://localhost/api/tenants/clinic-demo-a/support-requests?status=pending',
        ctx.auth('user_synth_owner_a'),
      )
      expect(list.status).toBe(200)
      const listBody = (await list.json()) as { requests: Array<{ id: string }> }
      expect(listBody.requests.some((r) => r.id === createdBody.request.id)).toBe(true)

      const attendantList = await ctx.app.request(
        'http://localhost/api/tenants/clinic-demo-a/support-requests',
        ctx.auth('user_synth_attendant_a'),
      )
      expect(attendantList.status).toBe(403)

      const approve = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-requests/${createdBody.request.id}/decision`,
        ctx.auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approve' }),
        }),
      )
      expect(approve.status).toBe(200)
      const approveBody = (await approve.json()) as {
        request: { status: string }
        accessGranted: boolean
        session: null
        handoff: null
      }
      expect(approveBody.request.status).toBe('approved')
      expect(approveBody.accessGranted).toBe(false)
      expect(approveBody.session).toBeNull()
      expect(approveBody.handoff).toBeNull()

      const sessions = ctx.boot.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM support_sessions WHERE support_access_request_id = ?`,
        createdBody.request.id,
      )
      expect(sessions?.n).toBe(0)

      const rejectReq = await createRequest(ctx, { reason: 'segundo pedido' })
      const rejectBody = (await rejectReq.json()) as { request: { id: string } }
      const reject = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-requests/${rejectBody.request.id}/decision`,
        ctx.auth('user_synth_owner_a2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'reject' }),
        }),
      )
      expect(reject.status).toBe(200)
      expect(((await reject.json()) as { request: { status: string } }).request.status).toBe(
        'rejected',
      )
    } finally {
      ctx.close()
    }
  })

  it('owner de B não decide A; attendant não decide; corrida: uma transição; expirado bloqueia', async () => {
    const ctx = testSupportApp()
    try {
      const created = await createRequest(ctx)
      const { request } = (await created.json()) as { request: { id: string } }

      const ownerB = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-requests/${request.id}/decision`,
        ctx.auth('user_synth_owner_b', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approve' }),
        }),
      )
      expect(ownerB.status).toBe(403)

      const attendant = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-requests/${request.id}/decision`,
        ctx.auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approve' }),
        }),
      )
      expect(attendant.status).toBe(403)

      const raceA = ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-requests/${request.id}/decision`,
        ctx.auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approve' }),
        }),
      )
      const raceB = ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-requests/${request.id}/decision`,
        ctx.auth('user_synth_owner_a2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'reject' }),
        }),
      )
      const [r1, r2] = await Promise.all([raceA, raceB])
      const statuses = [r1.status, r2.status].sort()
      expect(statuses).toEqual([200, 409])
      const final = getSupportRequest(ctx.boot.db, request.id)!
      expect(['approved', 'rejected']).toContain(final.status)

      const expiredCreate = await createRequest(ctx, { reason: 'expirar' })
      const expiredBody = (await expiredCreate.json()) as { request: { id: string } }
      ctx.clock.advance(SUPPORT_REQUEST_TTL_MS)
      const late = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/support-requests/${expiredBody.request.id}/decision`,
        ctx.auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approve' }),
        }),
      )
      expect(late.status).toBe(409)
      expect(((await late.json()) as { error: string }).error).toBe('support_request_expired')
      expect(
        ctx.boot.db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM support_sessions WHERE support_access_request_id = ?`,
          expiredBody.request.id,
        )?.n,
      ).toBe(0)
    } finally {
      ctx.close()
    }
  })

  it('reconnect reconstitui pending; owner removido deixa de listar; auditoria sem segredos', async () => {
    const ctx = testSupportApp()
    try {
      const created = await createRequest(ctx)
      const { request } = (await created.json()) as { request: { id: string } }

      const reconnect = await ctx.app.request(
        'http://localhost/api/tenants/clinic-demo-a/support-requests?status=pending',
        ctx.auth('user_synth_owner_a'),
      )
      expect(reconnect.status).toBe(200)
      const body = (await reconnect.json()) as { requests: Array<{ id: string }> }
      expect(body.requests.some((r) => r.id === request.id)).toBe(true)

      revokeMembership(ctx.boot.db, ctx.clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_owner_a2',
        actorClerkUserId: 'user_synth_owner_a',
        allowOwnerTarget: true,
      })
      const removed = await ctx.app.request(
        'http://localhost/api/tenants/clinic-demo-a/support-requests',
        ctx.auth('user_synth_owner_a2'),
      )
      expect(removed.status).toBe(403)

      const audit = listAuditForTenant(ctx.boot.db, 'clinic-demo-a')
      expect(audit.some((e) => e.action === 'support.request.create')).toBe(true)
      const blob = JSON.stringify(audit)
      expect(blob).not.toMatch(/handoff|sessionToken/)
      for (const mail of ctx.transport.mailbox) {
        if (mail.template === 'support_access_request') {
          expect(blob).not.toContain(mail.requestUrl)
        }
      }
    } finally {
      ctx.close()
    }
  })

  it('não-superadmin não cria pedido; subject inativo negado', async () => {
    const ctx = testSupportApp()
    try {
      const ownerCreate = await ctx.app.request(
        'http://localhost/api/platform/support-requests',
        ctx.auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: 'clinic-demo-a',
            subjectClerkUserId: 'user_synth_attendant_a',
            reason: 'x',
            scope: 'read',
          }),
        }),
      )
      expect(ownerCreate.status).toBe(403)

      revokeMembership(ctx.boot.db, ctx.clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_attendant_a',
        actorClerkUserId: 'user_synth_owner_a',
      })
      const badSubject = await createRequest(ctx)
      expect(badSubject.status).toBe(403)
    } finally {
      ctx.close()
    }
  })
})

describe('mailbox support — tipagem', () => {
  it('mensagens de suporte têm requestUrl tipado', () => {
    const transport: SimulatedEmailTransport = createSimulatedEmailTransport()
    expect(transport.mailbox).toEqual([])
  })
})
