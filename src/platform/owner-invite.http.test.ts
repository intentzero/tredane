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
  getMembership,
  INVITATION_RESEND_COOLDOWN_MS,
  INVITATION_TTL_MS,
  listAuditForTenant,
} from '../db/admin'
import { createControllableClock } from '../db/clock'
import {
  createSimulatedEmailTransport,
  tokenFromInviteUrl,
  type SimulatedEmailTransport,
} from '../email'

const SUPER = 'user_synth_superadmin'

function testApp() {
  const boot = bootAdminDb()
  const clock = createControllableClock(3_100_000_000_000)
  const transport = createSimulatedEmailTransport({ clock })
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(boot.db),
    verifiedEmails: createSyntheticVerifiedEmailReader(),
    staffProfiles: createSyntheticStaffProfileReader(),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => boot.db,
    clockFactory: () => clock,
    emailFactory: () => transport,
    appBaseUrlFactory: () => 'http://localhost:5173',
    eventPublisherFactory: () => ({
      async publishTenantEvent() {
        return { ok: true, seq: 1, delivered: [], revoked: [] }
      },
    }),
  })
  const call = (userId: string, path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', synthAuthHeader(userId))
    if (init.json !== undefined) headers.set('Content-Type', 'application/json')
    return app.request(`http://localhost${path}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    })
  }
  return { app, boot, clock, transport, close: boot.close, call }
}

type Created = {
  tenant: { id: string; status: string }
  invitation: { id: string; email: string; role: string; status: string; expiresAt: number; issuedAt: number; expired: boolean }
  emailSent: boolean
}

function lastToken(t: SimulatedEmailTransport): string {
  const msg = t.mailbox.at(-1)
  if (!msg || msg.template !== 'tenant_invitation') throw new Error('mailbox_empty')
  const token = tokenFromInviteUrl(msg.inviteUrl)
  if (!token) throw new Error('token_missing')
  return token
}

async function createClinic(ctx: ReturnType<typeof testApp>, email = 'Dona.Clinica@Example.Test') {
  const res = await ctx.call(SUPER, '/api/platform/tenants', {
    method: 'POST',
    json: { id: 'clinic-em-config', name: 'Clínica Jardim Sul', ownerEmail: email },
  })
  return { res, body: (await res.json()) as Created }
}

function accept(ctx: ReturnType<typeof testApp>, userId: string, email: string, token: string) {
  return ctx.call(userId, '/api/invitations/accept', {
    method: 'POST',
    headers: { 'X-Synth-Verified-Email': email },
    json: { token },
  })
}

describe('HTTP — primeira owner por convite do superadmin (#842, DEC-194)', () => {
  it('cria a clínica sem owner ativa e um convite de owner de 7 dias; e-mail enviado; token só no e-mail', async () => {
    const ctx = testApp()
    try {
      const { res, body } = await createClinic(ctx)
      expect(res.status).toBe(201)
      expect(body.tenant).toMatchObject({ id: 'clinic-em-config', status: 'active' })
      expect(body.invitation).toMatchObject({
        email: 'dona.clinica@example.test',
        role: 'owner',
        status: 'pending',
        expired: false,
      })
      expect(body.invitation.expiresAt - body.invitation.issuedAt).toBe(INVITATION_TTL_MS)
      expect(body.emailSent).toBe(true)
      expect(JSON.stringify(body)).not.toMatch(/token/i)

      const mail = ctx.transport.mailbox.at(-1)!
      expect(mail.template).toBe('tenant_invitation')
      expect(mail.toEmail).toBe('dona.clinica@example.test')
      expect(lastToken(ctx.transport).length).toBeGreaterThan(20)

      // Sem nenhum membership: a clínica está «em configuração».
      const members = ctx.boot.db.all<{ n: number }>(
        `SELECT COUNT(*) AS n FROM tenant_memberships WHERE tenant_id = 'clinic-em-config'`,
      )
      expect(Number(members[0]!.n)).toBe(0)

      const audit = listAuditForTenant(ctx.boot.db, 'clinic-em-config', { limit: 20 })
      expect(audit.map((e) => e.action).sort()).toEqual(
        expect.arrayContaining(['invitation.create', 'tenant.create', 'email.delivery.enqueue']),
      )
      expect(audit.find((e) => e.action === 'invitation.create')?.actorClerkUserId).toBe(SUPER)
      expect(JSON.stringify(audit)).not.toContain(lastToken(ctx.transport))
    } finally {
      ctx.close()
    }
  })

  it('lista e detalhe: ownerCount 0, convite pendente visível; passa a «expired» depois de 7 dias', async () => {
    const ctx = testApp()
    try {
      await createClinic(ctx)
      const list = (await (await ctx.call(SUPER, '/api/platform/tenants')).json()) as {
        tenants: Array<{ id: string; ownerCount: number; memberCount: number }>
      }
      expect(list.tenants.find((t) => t.id === 'clinic-em-config')).toMatchObject({ ownerCount: 0, memberCount: 0 })

      const detail = async () =>
        (await (await ctx.call(SUPER, '/api/platform/tenants/clinic-em-config')).json()) as {
          owners: unknown[]
          invitations: Array<{ email: string; expired: boolean; status: string }>
        }
      let d = await detail()
      expect(d.owners).toEqual([])
      expect(d.invitations).toEqual([expect.objectContaining({ email: 'dona.clinica@example.test', expired: false })])
      ctx.clock.advance(INVITATION_TTL_MS + 1)
      d = await detail()
      expect(d.invitations[0]).toMatchObject({ status: 'pending', expired: true })
    } finally {
      ctx.close()
    }
  })

  it('o aceite pela pessoa convidada cria o membership owner e a clínica deixa de estar em configuração', async () => {
    const ctx = testApp()
    try {
      await createClinic(ctx, 'invitee@example.test')
      const token = lastToken(ctx.transport)
      // E-mail diferente do convite → recusado, e o convite continua válido.
      expect((await accept(ctx, 'user_synth_invitee', 'outra@example.test', token)).status).toBe(409)
      const ok = await accept(ctx, 'user_synth_invitee', 'invitee@example.test', token)
      expect(ok.status).toBe(200)
      expect(getMembership(ctx.boot.db, 'clinic-em-config', 'user_synth_invitee')).toMatchObject({
        role: 'owner',
        status: 'active',
      })
      const list = (await (await ctx.call(SUPER, '/api/platform/tenants')).json()) as {
        tenants: Array<{ id: string; ownerCount: number }>
      }
      expect(list.tenants.find((t) => t.id === 'clinic-em-config')?.ownerCount).toBe(1)
      // O token não serve duas vezes.
      expect((await accept(ctx, 'user_synth_invitee', 'invitee@example.test', token)).status).toBe(409)
    } finally {
      ctx.close()
    }
  })

  it('validação: e-mail inválido, ambos os campos de owner e nome em falta são recusados sem criar nada', async () => {
    const ctx = testApp()
    try {
      const post = (json: unknown) => ctx.call(SUPER, '/api/platform/tenants', { method: 'POST', json })
      const bad = await post({ id: 'x1', name: 'X', ownerEmail: 'sem-arroba' })
      expect(bad.status).toBe(400)
      expect(await bad.json()).toEqual({ error: 'owner_email_invalid' })
      const both = await post({ id: 'x2', name: 'X', ownerEmail: 'a@b.co', ownerClerkUserId: 'user_x' })
      expect(both.status).toBe(400)
      expect(await both.json()).toEqual({ error: 'owner_ambiguous' })
      expect((await post({ id: 'x3', ownerEmail: 'a@b.co' })).status).toBe(400)
      expect((await post({ id: 'x4', name: 'X' })).status).toBe(400)
      const n = ctx.boot.db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM tenants WHERE id IN ('x1','x2','x3','x4')`)
      expect(Number(n[0]!.n)).toBe(0)
      expect(ctx.transport.mailbox).toHaveLength(0)
    } finally {
      ctx.close()
    }
  })

  it('só o superadmin cria; owners e flags não booleanas recebem 403', async () => {
    const ctx = testApp()
    try {
      for (const user of ['user_synth_owner_a', 'user_synth_string_super', 'user_synth_public_super']) {
        const res = await ctx.call(user, '/api/platform/tenants', {
          method: 'POST',
          json: { id: 'nope', name: 'Nope', ownerEmail: 'a@b.co' },
        })
        expect(res.status, user).toBe(403)
      }
      expect(ctx.transport.mailbox).toHaveLength(0)
    } finally {
      ctx.close()
    }
  })

  it('o caminho antigo com ownerClerkUserId continua a funcionar', async () => {
    const ctx = testApp()
    try {
      const res = await ctx.call(SUPER, '/api/platform/tenants', {
        method: 'POST',
        json: { id: 'clinic-legacy', name: 'Legacy', ownerClerkUserId: 'user_synth_platform_owner' },
      })
      expect(res.status).toBe(201)
      expect(getMembership(ctx.boot.db, 'clinic-legacy', 'user_synth_platform_owner')?.role).toBe('owner')
    } finally {
      ctx.close()
    }
  })

  it('reenviar roda o token (o antigo deixa de servir) e respeita o intervalo de 10 minutos', async () => {
    const ctx = testApp()
    try {
      const { body } = await createClinic(ctx, 'invitee@example.test')
      const oldToken = lastToken(ctx.transport)
      const path = `/api/platform/tenants/clinic-em-config/invitations/${body.invitation.id}/resend`
      ctx.clock.advance(INVITATION_RESEND_COOLDOWN_MS + 1)
      const resent = await ctx.call(SUPER, path, { method: 'POST' })
      expect(resent.status).toBe(200)
      expect((await resent.json()) as { emailSent: boolean }).toMatchObject({ emailSent: true })
      const newToken = lastToken(ctx.transport)
      expect(newToken).not.toBe(oldToken)
      expect((await accept(ctx, 'user_synth_invitee', 'invitee@example.test', oldToken)).status).toBe(409)

      const again = await ctx.call(SUPER, path, { method: 'POST' })
      expect(again.status).toBe(409)
      expect(await again.json()).toEqual({ error: 'invitation_resend_cooldown' })

      expect((await accept(ctx, 'user_synth_invitee', 'invitee@example.test', newToken)).status).toBe(200)
    } finally {
      ctx.close()
    }
  })

  it('cancelar invalida o link; depois dá para emitir um convite novo para o mesmo e-mail', async () => {
    const ctx = testApp()
    try {
      const { body } = await createClinic(ctx, 'invitee@example.test')
      const token = lastToken(ctx.transport)
      const cancel = await ctx.call(
        SUPER,
        `/api/platform/tenants/clinic-em-config/invitations/${body.invitation.id}/cancel`,
        { method: 'POST' },
      )
      expect(cancel.status).toBe(200)
      expect(((await cancel.json()) as { invitation: { status: string } }).invitation.status).toBe('cancelled')
      expect((await accept(ctx, 'user_synth_invitee', 'invitee@example.test', token)).status).toBe(409)

      const fresh = await ctx.call(SUPER, '/api/platform/tenants/clinic-em-config/invitations', {
        method: 'POST',
        json: { email: 'invitee@example.test' },
      })
      expect(fresh.status).toBe(201)
      expect((await fresh.json()) as { invitation: { role: string } }).toMatchObject({ invitation: { role: 'owner' } })
      expect((await accept(ctx, 'user_synth_invitee', 'invitee@example.test', lastToken(ctx.transport))).status).toBe(200)
    } finally {
      ctx.close()
    }
  })

  it('convite vencido não bloqueia um novo; reenviar um vencido diz que expirou', async () => {
    const ctx = testApp()
    try {
      const { body } = await createClinic(ctx, 'invitee@example.test')
      const oldToken = lastToken(ctx.transport)
      ctx.clock.advance(INVITATION_TTL_MS + 1)
      expect((await accept(ctx, 'user_synth_invitee', 'invitee@example.test', oldToken)).status).toBe(409)

      const resend = await ctx.call(
        SUPER,
        `/api/platform/tenants/clinic-em-config/invitations/${body.invitation.id}/resend`,
        { method: 'POST' },
      )
      expect(resend.status).toBe(409)
      expect(await resend.json()).toEqual({ error: 'invitation_expired' })

      const fresh = await ctx.call(SUPER, '/api/platform/tenants/clinic-em-config/invitations', {
        method: 'POST',
        json: { email: 'invitee@example.test' },
      })
      expect(fresh.status).toBe(201)
    } finally {
      ctx.close()
    }
  })

  it('convite duplicado pendente é recusado; e-mail inválido na emissão também', async () => {
    const ctx = testApp()
    try {
      await createClinic(ctx, 'invitee@example.test')
      const dup = await ctx.call(SUPER, '/api/platform/tenants/clinic-em-config/invitations', {
        method: 'POST',
        json: { email: 'INVITEE@example.test' },
      })
      expect(dup.status).toBe(409)
      expect(await dup.json()).toEqual({ error: 'invitation_already_pending' })
      const bad = await ctx.call(SUPER, '/api/platform/tenants/clinic-em-config/invitations', {
        method: 'POST',
        json: { email: 'nao-e-email' },
      })
      expect(bad.status).toBe(400)
    } finally {
      ctx.close()
    }
  })

  it('um convite de outra clínica não se reenvia nem cancela pela URL desta', async () => {
    const ctx = testApp()
    try {
      const { body } = await createClinic(ctx, 'invitee@example.test')
      const tokenBefore = lastToken(ctx.transport)
      ctx.clock.advance(INVITATION_RESEND_COOLDOWN_MS + 1)
      for (const action of ['resend', 'cancel']) {
        const res = await ctx.call(
          SUPER,
          `/api/platform/tenants/clinic-demo-a/invitations/${body.invitation.id}/${action}`,
          { method: 'POST' },
        )
        expect(res.status, action).toBe(404)
      }
      // O convite não foi tocado: o token antigo ainda serve.
      expect((await accept(ctx, 'user_synth_invitee', 'invitee@example.test', tokenBefore)).status).toBe(200)
    } finally {
      ctx.close()
    }
  })

  it('owners e outros utilizadores não usam as rotas de convite da plataforma', async () => {
    const ctx = testApp()
    try {
      const { body } = await createClinic(ctx)
      for (const [path, json] of [
        ['/api/platform/tenants/clinic-em-config/invitations', { email: 'a@b.co' }],
        [`/api/platform/tenants/clinic-em-config/invitations/${body.invitation.id}/resend`, undefined],
        [`/api/platform/tenants/clinic-em-config/invitations/${body.invitation.id}/cancel`, undefined],
      ] as const) {
        const res = await ctx.call('user_synth_owner_a', path, { method: 'POST', json })
        expect(res.status, path).toBe(403)
      }
    } finally {
      ctx.close()
    }
  })

  it('clínica sem owner ativa não aceita pedidos de suporte (ninguém pode aprovar)', async () => {
    const ctx = testApp()
    try {
      await createClinic(ctx)
      const res = await ctx.call(SUPER, '/api/platform/support-requests', {
        method: 'POST',
        json: {
          tenantId: 'clinic-em-config',
          subjectClerkUserId: 'user_synth_owner_a',
          reason: 'Verificar configuração',
          scope: 'read_diagnostics',
        },
      })
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'no_active_owner' })
    } finally {
      ctx.close()
    }
  })
})
