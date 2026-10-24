import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  synthAuthHeader,
  type AuthServices,
} from './index'
import { revokeMembership } from '../db/admin'
import { createControllableClock } from '../db/clock'

function testApp() {
  const boot = bootAdminDb()
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({
      authorizedParties: ['http://localhost:5173'],
    }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(boot.db),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => boot.db,
    invalidatorFactory: () => ({
      async applyUserFence() {
        return { ok: true, closedConnections: [] }
      },
      async applyTenantSuspended() {
        return { ok: true, closedConnections: [] }
      },
      async applyTenantReactivated() {
        return { ok: true, closedConnections: [] }
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

describe('HTTP — Clerk/tenant auth (#21)', () => {
  it('GET /api/me exige sessão', async () => {
    const { app, close } = testApp()
    try {
      const missing = await app.request('http://localhost/api/me')
      expect(missing.status).toBe(401)
      expect(await missing.json()).toEqual({ error: 'unauthenticated' })

      const expired = await app.request(
        'http://localhost/api/me',
        { headers: { Authorization: synthAuthHeader('user_synth_expired') } },
      )
      expect(expired.status).toBe(401)
      expect(await expired.json()).toEqual({ error: 'session_expired' })
    } finally {
      close()
    }
  })

  it('GET /api/me/tenants devolve roles D1 por tenant', async () => {
    const { app, close, auth } = testApp()
    try {
      const res = await app.request(
        'http://localhost/api/me/tenants',
        auth('user_synth_multi'),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        tenants: [
          {
            tenantId: 'clinic-demo-a',
            name: 'Clínica Aurora (fictícia)',
            role: 'owner',
            status: 'active',
          },
          {
            tenantId: 'clinic-demo-b',
            name: 'Estúdio Horizonte (fictício)',
            role: 'attendant',
            status: 'active',
          },
        ],
      })
    } finally {
      close()
    }
  })

  it('contexto e probes respeitam isolamento e DEC-042', async () => {
    const { app, close, auth } = testApp()
    try {
      const denied = await app.request(
        'http://localhost/api/tenants/clinic-demo-b/context',
        auth('user_synth_attendant_a'),
      )
      expect(denied.status).toBe(403)
      expect(await denied.json()).toEqual({ error: 'tenant_access_denied' })

      const forged = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/context',
        auth('user_synth_attendant_a', {
          headers: { 'X-Claimed-Role': 'owner' },
        }),
      )
      expect(forged.status).toBe(403)
      expect(await forged.json()).toEqual({ error: 'forged_role_rejected' })

      const ok = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox-probe',
        auth('user_synth_attendant_a'),
      )
      expect(ok.status).toBe(200)

      const configDenied = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config-probe',
        { method: 'POST', ...auth('user_synth_attendant_a') },
      )
      expect(configDenied.status).toBe(403)

      const configOk = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config-probe',
        { method: 'POST', ...auth('user_synth_owner_a') },
      )
      expect(configOk.status).toBe(200)
    } finally {
      close()
    }
  })

  it('Platform Admin: string/public/failure negados; boolean ok', async () => {
    const { app, close, auth } = testApp()
    try {
      for (const user of [
        'user_synth_owner_a',
        'user_synth_string_super',
        'user_synth_public_super',
      ]) {
        const res = await app.request(
          'http://localhost/api/platform/tenants',
          auth(user),
        )
        expect(res.status).toBe(403)
      }

      const ok = await app.request(
        'http://localhost/api/platform/tenants',
        auth('user_synth_superadmin'),
      )
      expect(ok.status).toBe(200)
      const body = await ok.json() as { tenants: Array<{ id: string }> }
      expect(body.tenants.some((t) => t.id === 'clinic-demo-a')).toBe(true)
    } finally {
      close()
    }
  })

  it('revogação em A corta HTTP A e preserva B', async () => {
    const { app, boot, close, auth } = testApp()
    const clock = createControllableClock(2_000_000_000_000)
    try {
      revokeMembership(boot.db, clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_multi',
        actorClerkUserId: 'user_synth_owner_a',
        allowOwnerTarget: true,
      })

      const a = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/context',
        auth('user_synth_multi'),
      )
      expect(a.status).toBe(403)

      const b = await app.request(
        'http://localhost/api/tenants/clinic-demo-b/context',
        auth('user_synth_multi'),
      )
      expect(b.status).toBe(200)
      expect(await b.json()).toMatchObject({
        tenantId: 'clinic-demo-b',
        role: 'attendant',
      })
    } finally {
      close()
    }
  })
})
