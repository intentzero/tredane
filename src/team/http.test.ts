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
  getMembership,
  INVITATION_RESEND_COOLDOWN_MS,
  INVITATION_RESEND_MAX,
  INVITATION_TTL_MS,
  listAuditForTenant,
} from '../db/admin'
import { createControllableClock } from '../db/clock'
import {
  createSimulatedEmailTransport,
  tokenFromInviteUrl,
  type SimulatedEmailTransport,
} from '../email'
import { hashToken } from '../db/tokens'

function testTeamApp() {
  const boot = bootAdminDb()
  const clock = createControllableClock(3_100_000_000_000)
  const transport = createSimulatedEmailTransport({ clock })
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
  })
  return {
    app,
    boot,
    clock,
    transport,
    close: boot.close,
    auth: (userId: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', synthAuthHeader(userId))
      return { ...init, headers }
    },
  }
}

async function invite(
  ctx: ReturnType<typeof testTeamApp>,
  email: string,
  owner = 'user_synth_owner_a',
  tenantId = 'clinic-demo-a',
) {
  const res = await ctx.app.request(
    `http://localhost/api/tenants/${tenantId}/invitations`,
    ctx.auth(owner, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  )
  return res
}

function lastToken(transport: SimulatedEmailTransport): string {
  const msg = transport.mailbox.at(-1)
  if (!msg || msg.template !== 'tenant_invitation') throw new Error('mailbox_empty')
  const token = tokenFromInviteUrl(msg.inviteUrl)
  if (!token) throw new Error('token_missing')
  return token
}

describe('HTTP — Equipe e convites (#25)', () => {
  it('owner convida; aceite com e-mail verificado; membership A; B preservado; token ausente na API/audit', async () => {
    const ctx = testTeamApp()
    try {
      const created = await invite(ctx, 'Invitee@Example.Test')
      expect(created.status).toBe(201)
      const createdBody = (await created.json()) as {
        invitation: { id: string; email: string }
        emailSent: boolean
      }
      expect(createdBody.emailSent).toBe(true)
      expect(createdBody.invitation.email).toBe('invitee@example.test')
      expect(JSON.stringify(createdBody)).not.toMatch(/token/i)

      const token = lastToken(ctx.transport)
      expect(token.length).toBeGreaterThan(20)

      const accept = await ctx.app.request(
        'http://localhost/api/invitations/accept',
        ctx.auth('user_synth_invitee', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Synth-Verified-Email': 'invitee@example.test',
          },
          body: JSON.stringify({
            token,
            tenantId: 'clinic-demo-b',
            role: 'owner',
          }),
        }),
      )
      expect(accept.status).toBe(200)
      const accepted = (await accept.json()) as {
        membership: { tenantId: string; role: string }
      }
      expect(accepted.membership).toMatchObject({
        tenantId: 'clinic-demo-a',
        role: 'attendant',
      })

      expect(
        getMembership(ctx.boot.db, 'clinic-demo-a', 'user_synth_invitee')?.role,
      ).toBe('attendant')
      // multi em B intacto
      expect(
        getMembership(ctx.boot.db, 'clinic-demo-b', 'user_synth_multi')?.status,
      ).toBe('active')

      const audit = listAuditForTenant(ctx.boot.db, 'clinic-demo-a')
      expect(JSON.stringify(audit)).not.toContain(token)

      // Replay
      const replay = await ctx.app.request(
        'http://localhost/api/invitations/accept',
        ctx.auth('user_synth_invitee', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Synth-Verified-Email': 'invitee@example.test',
          },
          body: JSON.stringify({ token }),
        }),
      )
      expect(replay.status).toBe(409)
    } finally {
      ctx.close()
    }
  })

  it('e-mail errado / não verificado nega sem consumir; expiração em expires_at', async () => {
    const ctx = testTeamApp()
    try {
      await invite(ctx, 'strict@example.test')
      const token = lastToken(ctx.transport)

      const wrong = await ctx.app.request(
        'http://localhost/api/invitations/accept',
        ctx.auth('user_synth_invitee', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Synth-Verified-Email': 'other@example.test',
          },
          body: JSON.stringify({ token }),
        }),
      )
      expect(wrong.status).toBe(409)
      expect(await wrong.json()).toMatchObject({ error: 'invitation_email_mismatch' })

      const unverified = await ctx.app.request(
        'http://localhost/api/invitations/accept',
        ctx.auth('user_synth_unverified', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Synth-Verified-Email': '',
          },
          body: JSON.stringify({ token }),
        }),
      )
      expect(unverified.status).toBe(403)
      expect(await unverified.json()).toMatchObject({
        error: 'invitation_email_unverified',
      })

      // Token ainda válido
      const stored = ctx.boot.db.get<{ status: string; token_hash: string }>(
        `SELECT status, token_hash FROM tenant_invitations WHERE normalized_email = ?`,
        'strict@example.test',
      )
      expect(stored?.status).toBe('pending')
      expect(stored?.token_hash).toBe(await hashToken(token))

      ctx.clock.advance(INVITATION_TTL_MS)
      const expired = await ctx.app.request(
        'http://localhost/api/invitations/accept',
        ctx.auth('user_synth_invitee', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Synth-Verified-Email': 'strict@example.test',
          },
          body: JSON.stringify({ token }),
        }),
      )
      expect(expired.status).toBe(409)
      expect(await expired.json()).toMatchObject({ error: 'invitation_expired' })
    } finally {
      ctx.close()
    }
  })

  it('reenvio: rotação, cooldown, quota; bloqueio não invalida token vigente', async () => {
    const ctx = testTeamApp()
    try {
      const created = await invite(ctx, 'rotate@example.test')
      const body = (await created.json()) as { invitation: { id: string } }
      const invId = body.invitation.id
      const token1 = lastToken(ctx.transport)

      const resend1 = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/invitations/${invId}/resend`,
        ctx.auth('user_synth_owner_a2', { method: 'POST' }),
      )
      expect(resend1.status).toBe(200)
      const token2 = lastToken(ctx.transport)
      expect(token2).not.toBe(token1)

      // Token antigo inválido
      const oldAccept = await ctx.app.request(
        'http://localhost/api/invitations/accept',
        ctx.auth('user_synth_invitee', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Synth-Verified-Email': 'rotate@example.test',
          },
          body: JSON.stringify({ token: token1 }),
        }),
      )
      expect(oldAccept.status).toBe(409)

      // Cooldown — não invalida token2
      const cool = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/invitations/${invId}/resend`,
        ctx.auth('user_synth_owner_a', { method: 'POST' }),
      )
      expect(cool.status).toBe(429)
      const coolBody = (await cool.json()) as {
        error: string
        retryAfterMs: number
      }
      expect(coolBody.error).toBe('invitation_resend_cooldown')
      expect(coolBody.retryAfterMs).toBeGreaterThan(0)

      const stillPending = ctx.boot.db.get<{ token_hash: string; status: string }>(
        `SELECT token_hash, status FROM tenant_invitations WHERE id = ?`,
        invId,
      )
      expect(stillPending?.status).toBe('pending')
      expect(stillPending?.token_hash).toBe(await hashToken(token2))

      for (let i = 0; i < INVITATION_RESEND_MAX - 1; i++) {
        ctx.clock.advance(INVITATION_RESEND_COOLDOWN_MS)
        const r = await ctx.app.request(
          `http://localhost/api/tenants/clinic-demo-a/invitations/${invId}/resend`,
          ctx.auth('user_synth_owner_a', { method: 'POST' }),
        )
        expect(r.status).toBe(200)
      }
      ctx.clock.advance(INVITATION_RESEND_COOLDOWN_MS)
      const sixth = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/invitations/${invId}/resend`,
        ctx.auth('user_synth_owner_a', { method: 'POST' }),
      )
      expect(sixth.status).toBe(429)
      expect(await sixth.json()).toMatchObject({ error: 'invitation_resend_quota' })
    } finally {
      ctx.close()
    }
  })

  it('cancelamento por outro owner; attendant/owner B negados; cancel não remove membership', async () => {
    const ctx = testTeamApp()
    try {
      const created = await invite(ctx, 'cancel@example.test')
      const { invitation } = (await created.json()) as { invitation: { id: string } }
      const token = lastToken(ctx.transport)

      const asAttendant = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/invitations/${invitation.id}/cancel`,
        ctx.auth('user_synth_attendant_a', { method: 'POST' }),
      )
      expect(asAttendant.status).toBe(403)

      const asOwnerB = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/invitations/${invitation.id}/cancel`,
        ctx.auth('user_synth_owner_b', { method: 'POST' }),
      )
      expect(asOwnerB.status).toBe(403)

      const cancelled = await ctx.app.request(
        `http://localhost/api/tenants/clinic-demo-a/invitations/${invitation.id}/cancel`,
        ctx.auth('user_synth_owner_a2', { method: 'POST' }),
      )
      expect(cancelled.status).toBe(200)

      const after = await ctx.app.request(
        'http://localhost/api/invitations/accept',
        ctx.auth('user_synth_invitee', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Synth-Verified-Email': 'cancel@example.test',
          },
          body: JSON.stringify({ token }),
        }),
      )
      expect(after.status).toBe(409)

      // Membership existente de attendant_a não muda
      expect(
        getMembership(ctx.boot.db, 'clinic-demo-a', 'user_synth_attendant_a')?.status,
      ).toBe('active')
    } finally {
      ctx.close()
    }
  })

  it('corridas aceite × cancelamento e aceite × reenvio: um único efeito válido', async () => {
    const ctx = testTeamApp()
    try {
      const created = await invite(ctx, 'race@example.test')
      const { invitation } = (await created.json()) as { invitation: { id: string } }
      const token = lastToken(ctx.transport)

      const [acceptRes, cancelRes] = await Promise.all([
        ctx.app.request(
          'http://localhost/api/invitations/accept',
          ctx.auth('user_synth_invitee', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Synth-Verified-Email': 'race@example.test',
            },
            body: JSON.stringify({ token }),
          }),
        ),
        ctx.app.request(
          `http://localhost/api/tenants/clinic-demo-a/invitations/${invitation.id}/cancel`,
          ctx.auth('user_synth_owner_a2', { method: 'POST' }),
        ),
      ])

      const outcomes = [acceptRes.status, cancelRes.status].sort()
      // Um 200 e um 409 (ou ambos serializados com um sucesso)
      expect(outcomes.filter((s) => s === 200)).toHaveLength(1)
      expect(outcomes.some((s) => s === 409 || s === 200)).toBe(true)

      const status = ctx.boot.db.get<{ status: string }>(
        `SELECT status FROM tenant_invitations WHERE id = ?`,
        invitation.id,
      )?.status
      expect(['accepted', 'cancelled']).toContain(status)
      if (status === 'accepted') {
        expect(
          getMembership(ctx.boot.db, 'clinic-demo-a', 'user_synth_invitee')?.status,
        ).toBe('active')
      } else {
        expect(
          getMembership(ctx.boot.db, 'clinic-demo-a', 'user_synth_invitee'),
        ).toBeUndefined()
      }

      // Reenvio vs aceite com segundo convite
      const created2 = await invite(ctx, 'race2@example.test')
      const inv2 = (await created2.json()) as { invitation: { id: string } }
      const tokenA = lastToken(ctx.transport)
      ctx.clock.advance(INVITATION_RESEND_COOLDOWN_MS)

      const [accept2, resend2] = await Promise.all([
        ctx.app.request(
          'http://localhost/api/invitations/accept',
          ctx.auth('user_synth_invitee', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Synth-Verified-Email': 'race2@example.test',
            },
            body: JSON.stringify({ token: tokenA }),
          }),
        ),
        ctx.app.request(
          `http://localhost/api/tenants/clinic-demo-a/invitations/${inv2.invitation.id}/resend`,
          ctx.auth('user_synth_owner_a', { method: 'POST' }),
        ),
      ])
      // Exactamente um efeito vencedor coerente: membership OU token rodado
      const st2 = ctx.boot.db.get<{ status: string; token_hash: string }>(
        `SELECT status, token_hash FROM tenant_invitations WHERE id = ?`,
        inv2.invitation.id,
      )!
      if (accept2.status === 200) {
        expect(st2.status).toBe('accepted')
      } else if (resend2.status === 200) {
        expect(st2.status).toBe('pending')
        expect(st2.token_hash).not.toBe(await hashToken(tokenA))
      } else {
        // Ambos falharam só se o outro ganhou — pelo menos um 200
        expect([accept2.status, resend2.status].includes(200)).toBe(true)
      }
    } finally {
      ctx.close()
    }
  })

  it('owner só gere attendants da própria clínica; lista equipe marca owners sem ações', async () => {
    const ctx = testTeamApp()
    try {
      const cross = await invite(
        ctx,
        'cross@example.test',
        'user_synth_owner_a',
        'clinic-demo-b',
      )
      expect(cross.status).toBe(403)

      const team = await ctx.app.request(
        'http://localhost/api/tenants/clinic-demo-a/team',
        ctx.auth('user_synth_owner_a'),
      )
      expect(team.status).toBe(200)
      const body = (await team.json()) as {
        members: Array<{
          role: string
          manageActions: { canRevoke: boolean }
        }>
      }
      const owners = body.members.filter((m) => m.role === 'owner')
      expect(owners.length).toBeGreaterThan(0)
      expect(owners.every((o) => o.manageActions.canRevoke === false)).toBe(true)
      const attendants = body.members.filter((m) => m.role === 'attendant')
      expect(attendants.every((a) => a.manageActions.canRevoke === true)).toBe(true)
    } finally {
      ctx.close()
    }
  })
})
