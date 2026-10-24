/**
 * API-level: duas clínicas, roles distintas, credenciais revogadas (#45).
 * Sessões Clerk sintéticas; sem chaves reais.
 */
import { describe, expect, it } from 'vitest'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import { asyncFromSync } from '../db/admin/async-store'
import { getMembership } from '../db/admin/memberships'
import { bootAdminDb } from '../db/test-db'
import { bootClinicDb } from '../clinic/test-db'
import { createMemoryInboxRegistry } from '../inbox/gateway'
import { createApp } from '../worker/app'

function ensureClinic(
  clinics: Map<string, ReturnType<typeof bootClinicDb>>,
  tenantId: string,
) {
  let boot = clinics.get(tenantId)
  if (!boot) {
    boot = bootClinicDb()
    clinics.set(tenantId, boot)
  }
  return boot
}

function testApp() {
  const admin = bootAdminDb()
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const registry = createMemoryInboxRegistry((tenantId) => {
    const boot = ensureClinic(clinics, tenantId)
    return { db: boot.db, clock: boot.clock }
  })
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({
      authorizedParties: ['http://localhost:5173'],
    }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(admin.db),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => admin.db,
    inboxGatewayFactory: (_env, tenantId) => registry(tenantId),
    invalidatorFactory: () => ({
      async applyUserFence() {
        return { ok: true, closedConnections: ['ws_a_session_1', 'ws_a_session_2'] }
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
    admin,
    clinics,
    close: () => {
      for (const c of clinics.values()) c.close()
      admin.close()
    },
    auth: (userId: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', synthAuthHeader(userId))
      return { ...init, headers }
    },
  }
}

describe('MVP-31 — API roles / duas sessões / revogação (#45)', () => {
  it('AC-17: multi-tenant — roles por tenant; A owner e B attendant', async () => {
    const { app, close, auth } = testApp()
    try {
      const me = await app.request(
        'http://localhost/api/me/tenants',
        auth('user_synth_multi'),
      )
      expect(me.status).toBe(200)
      const body = (await me.json()) as {
        tenants: Array<{ tenantId: string; role: string }>
      }
      expect(body.tenants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tenantId: 'clinic-demo-a', role: 'owner' }),
          expect.objectContaining({ tenantId: 'clinic-demo-b', role: 'attendant' }),
        ]),
      )
    } finally {
      close()
    }
  })

  it('AC-01/08: duas sessões A (owner + attendant) vêem inbox; B negado em A', async () => {
    const { app, close, auth } = testApp()
    try {
      for (const user of ['user_synth_owner_a', 'user_synth_attendant_a'] as const) {
        const seed = await app.request(
          'http://localhost/api/tenants/clinic-demo-a/inbox/seed-demo',
          auth(user, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }),
        )
        expect(seed.status).toBe(200)

        const list = await app.request(
          'http://localhost/api/tenants/clinic-demo-a/inbox/conversations',
          auth(user),
        )
        expect(list.status).toBe(200)
        const payload = (await list.json()) as { conversations: unknown[] }
        expect(payload.conversations.length).toBeGreaterThan(0)
      }

      const cross = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/conversations',
        auth('user_synth_owner_b'),
      )
      expect(cross.status).toBe(403)

      const seedB = await app.request(
        'http://localhost/api/tenants/clinic-demo-b/inbox/seed-demo',
        auth('user_synth_owner_b', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      )
      expect(seedB.status).toBe(200)
    } finally {
      close()
    }
  })

  it('AC-02: revogar attendant A corta A; multi mantém B; Clerk autenticável', async () => {
    const { app, admin, close, auth } = testApp()
    try {
      const revoke = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/members/user_synth_attendant_a/revoke',
        auth('user_synth_owner_a', { method: 'POST' }),
      )
      expect(revoke.status).toBe(200)
      const revokeBody = (await revoke.json()) as {
        status: string
        closedConnections: string[]
      }
      expect(revokeBody.status).toBe('revoked')
      expect(revokeBody.closedConnections.length).toBeGreaterThanOrEqual(1)

      expect(
        getMembership(admin.db, 'clinic-demo-a', 'user_synth_attendant_a')?.status,
      ).toBe('revoked')

      const denied = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/conversations',
        auth('user_synth_attendant_a'),
      )
      expect(denied.status).toBe(403)

      const stillAuth = await app.request(
        'http://localhost/api/me',
        auth('user_synth_attendant_a'),
      )
      expect(stillAuth.status).toBe(200)

      await app.request(
        'http://localhost/api/tenants/clinic-demo-b/inbox/seed-demo',
        auth('user_synth_multi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      )
      const multiB = await app.request(
        'http://localhost/api/tenants/clinic-demo-b/inbox/conversations',
        auth('user_synth_multi'),
      )
      expect(multiB.status).toBe(200)
      expect(
        getMembership(admin.db, 'clinic-demo-b', 'user_synth_multi')?.status,
      ).toBe('active')
    } finally {
      close()
    }
  })

  it('AC-03: sem membership e string superadmin não acedem clínica', async () => {
    const { app, close, auth } = testApp()
    try {
      const noAccess = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/conversations',
        auth('user_synth_no_access'),
      )
      expect(noAccess.status).toBe(403)

      const stringSuper = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/conversations',
        auth('user_synth_string_super'),
      )
      expect(stringSuper.status).toBe(403)
    } finally {
      close()
    }
  })

  it('credencial inválida / expirada → 401', async () => {
    const { app, close, auth } = testApp()
    try {
      const missing = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/conversations',
      )
      expect(missing.status).toBe(401)

      const expired = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/conversations',
        auth('user_synth_expired'),
      )
      expect(expired.status).toBe(401)
    } finally {
      close()
    }
  })
})
