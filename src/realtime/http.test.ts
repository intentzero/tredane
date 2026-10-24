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

  it('attendant não revoga; owner não remove owner', async () => {
    const { app, close, auth } = testApp()
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
      expect(ownerTarget.status).toBe(403)
      expect(await ownerTarget.json()).toEqual({ error: 'cannot_revoke_owner' })
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
})
