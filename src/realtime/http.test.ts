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
import { createFailingInvalidator, type ClinicAccessInvalidator } from './index'
import { getMembership } from '../db/admin/memberships'

function testApp(opts: {
  invalidator?: ClinicAccessInvalidator
  issued?: Array<{ tenantId: string; identity: unknown }>
} = {}) {
  const boot = bootAdminDb()
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({
      authorizedParties: ['http://localhost:5173'],
    }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(boot.db),
  }
  const invalidator = opts.invalidator ?? {
    async applyUserFence() {
      return { ok: true, closedConnections: ['ws_fake'] }
    },
    async applyTenantSuspended() {
      return { ok: true, closedConnections: [] }
    },
    async applyTenantReactivated() {
      return { ok: true, closedConnections: [] }
    },
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => boot.db,
    invalidatorFactory: () => invalidator,
    wsTicketIssuerFactory: () => ({
      async issue(tenantId, identity) {
        opts.issued?.push({ tenantId, identity })
        return { ticket: `wst_${'x'.repeat(43)}`, expiresAt: 42 }
      },
    }),
  })
  return {
    app,
    boot,
    close: boot.close,
    auth: (userId: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', synthAuthHeader(userId))
      return { ...init, headers }
    },
  }
}

describe('HTTP — revogação e realtime (#23)', () => {
  it('owner revoga attendant em A; B do multi preservado; Clerk não é logout', async () => {
    const { app, boot, close, auth } = testApp()
    try {
      const res = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/members/user_synth_attendant_a/revoke',
        auth('user_synth_owner_a', { method: 'POST' }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        status: string
        doNotified: boolean
        closedConnections: string[]
      }
      expect(body.status).toBe('revoked')
      expect(body.doNotified).toBe(true)
      expect(body.closedConnections).toEqual(['ws_fake'])

      expect(
        getMembership(boot.db, 'clinic-demo-a', 'user_synth_attendant_a')?.status,
      ).toBe('revoked')
      expect(
        getMembership(boot.db, 'clinic-demo-b', 'user_synth_multi')?.status,
      ).toBe('active')

      // Sessão Clerk sintética continua autenticável.
      const me = await app.request('http://localhost/api/me', auth('user_synth_attendant_a'))
      expect(me.status).toBe(200)

      const denied = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox-probe',
        auth('user_synth_attendant_a'),
      )
      expect(denied.status).toBe(403)
    } finally {
      close()
    }
  })

  it('falha de notificação DO não reverte revoke no D1', async () => {
    const { app, boot, close, auth } = testApp({
      invalidator: createFailingInvalidator('do_down'),
    })
    try {
      const res = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/members/user_synth_attendant_a/revoke',
        auth('user_synth_owner_a', { method: 'POST' }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { doNotified: boolean; doError: string; status: string }
      expect(body.status).toBe('revoked')
      expect(body.doNotified).toBe(false)
      expect(body.doError).toBe('do_down')
      expect(
        getMembership(boot.db, 'clinic-demo-a', 'user_synth_attendant_a')?.status,
      ).toBe('revoked')
    } finally {
      close()
    }
  })

  it('attendant não revoga; owner remove outro owner; último owner protegido (DEC-103)', async () => {
    const { app, boot, close, auth } = testApp()
    try {
      const asAttendant = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/members/user_synth_owner_a2/revoke',
        auth('user_synth_attendant_a', { method: 'POST' }),
      )
      expect(asAttendant.status).toBe(403)

      const ownerTarget = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/members/user_synth_owner_a2/revoke',
        auth('user_synth_owner_a', { method: 'POST' }),
      )
      expect(ownerTarget.status).toBe(200)
      expect(
        getMembership(boot.db, 'clinic-demo-a', 'user_synth_owner_a2')?.status,
      ).toBe('revoked')

      const selfRevoke = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/members/user_synth_owner_a/revoke',
        auth('user_synth_owner_a', { method: 'POST' }),
      )
      expect(selfRevoke.status).toBe(400)
      expect(await selfRevoke.json()).toEqual({ error: 'cannot_revoke_self' })

      // Só resta um owner ativo — revoke por outro caminho de membership continua protegido.
      expect(
        getMembership(boot.db, 'clinic-demo-a', 'user_synth_owner_a')?.role,
      ).toBe('owner')
      expect(
        getMembership(boot.db, 'clinic-demo-a', 'user_synth_owner_a')?.status,
      ).toBe('active')
    } finally {
      close()
    }
  })

  it('WS sem Upgrade → 426; sem membership → 403', async () => {
    const { app, close, auth } = testApp()
    try {
      const noUpgrade = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/ws',
        auth('user_synth_attendant_a'),
      )
      expect(noUpgrade.status).toBe(426)

      const noAccess = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/ws',
        auth('user_synth_no_access', { headers: { Upgrade: 'websocket' } }),
      )
      expect(noAccess.status).toBe(403)
    } finally {
      close()
    }
  })

  it('WS sem sessão nem bilhete → 401 (upgrade não autenticado)', async () => {
    const { app, close } = testApp()
    try {
      const res = await app.request('http://localhost/api/tenants/clinic-demo-a/ws', {
        headers: { Upgrade: 'websocket' },
      })
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })

  it('WS com bilhete malformado → 401; tenant inválido → 403; Origin estranha → 403', async () => {
    const { app, close } = testApp()
    try {
      const bad = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/ws?ticket=nope',
        { headers: { Upgrade: 'websocket' } },
      )
      expect(bad.status).toBe(401)
      const ticket = `wst_${'A'.repeat(43)}`
      const badTenant = await app.request(
        `http://localhost/api/tenants/not-a-tenant/ws?ticket=${ticket}`,
        { headers: { Upgrade: 'websocket' } },
      )
      expect(badTenant.status).toBe(403)
      const evilOrigin = await app.request(
        `http://localhost/api/tenants/clinic-demo-a/ws?ticket=${ticket}`,
        {
          headers: { Upgrade: 'websocket', Origin: 'https://evil.example' },
        },
        { CLERK_AUTHORIZED_PARTIES: 'http://localhost:5173' },
      )
      expect(evilOrigin.status).toBe(403)
    } finally {
      close()
    }
  })

  it('bilhete: exige sessão (401), membership do tenant (403) e emite para o membro', async () => {
    const issued: Array<{ tenantId: string; identity: unknown }> = []
    const { app, close, auth } = testApp({ issued })
    try {
      const anon = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/realtime/ticket',
        { method: 'POST' },
      )
      expect(anon.status).toBe(401)

      // Owner de A não tem membership em B → 403, sem emitir.
      const otherTenant = await app.request(
        'http://localhost/api/tenants/clinic-demo-b/realtime/ticket',
        auth('user_synth_owner_a', { method: 'POST' }),
      )
      expect(otherTenant.status).toBe(403)

      const noAccess = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/realtime/ticket',
        auth('user_synth_no_access', { method: 'POST' }),
      )
      expect(noAccess.status).toBe(403)
      expect(issued).toHaveLength(0)

      const ok = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/realtime/ticket',
        auth('user_synth_attendant_a', { method: 'POST' }),
      )
      expect(ok.status).toBe(200)
      expect(ok.headers.get('Cache-Control')).toBe('no-store')
      expect(await ok.json()).toEqual({ ticket: `wst_${'x'.repeat(43)}`, expiresAt: 42 })
      expect(issued).toEqual([
        {
          tenantId: 'clinic-demo-a',
          identity: {
            clerkUserId: 'user_synth_attendant_a',
            sessionId: expect.any(String),
            role: 'attendant',
          },
        },
      ])
    } finally {
      close()
    }
  })
})
