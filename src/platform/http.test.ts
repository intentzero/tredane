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
import { getMembership, getTenant, listAuditForTenant } from '../db/admin'
import type { ClinicAccessInvalidator } from '../realtime'

function testApp(opts: { invalidator?: ClinicAccessInvalidator } = {}) {
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
      return { ok: true, closedConnections: ['ws_platform'] }
    },
    async applyTenantSuspended() {
      return { ok: true, closedConnections: ['ws_all'] }
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

describe('HTTP — Platform Admin (#24)', () => {
  it('owner/attendant/flags não booleanas não acedem; superadmin ok', async () => {
    const { app, close, auth } = testApp()
    try {
      for (const user of [
        'user_synth_owner_a',
        'user_synth_attendant_a',
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
    } finally {
      close()
    }
  })

  it('superadmin sem suporte não lê conteúdo clínico', async () => {
    const { app, close, auth } = testApp()
    try {
      const probe = await app.request(
        'http://localhost/api/platform/tenants/clinic-demo-a/clinical-probe',
        auth('user_synth_superadmin'),
      )
      expect(probe.status).toBe(403)
      expect(await probe.json()).toMatchObject({ clinicalAccess: false })

      const inbox = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox-probe',
        auth('user_synth_superadmin'),
      )
      expect(inbox.status).toBe(403)

      const detail = await app.request(
        'http://localhost/api/platform/tenants/clinic-demo-a',
        auth('user_synth_superadmin'),
      )
      expect(detail.status).toBe(200)
      const body = (await detail.json()) as {
        clinicalAccess: boolean
        integration: { whatsapp: { status: string } }
        members: unknown[]
      }
      expect(body.clinicalAccess).toBe(false)
      expect(body.integration.whatsapp.status).toBe('not_connected')
      expect(JSON.stringify(body)).not.toMatch(/mensagem|message body|waId/i)
    } finally {
      close()
    }
  })

  it('CRUD ciclo: criar, editar, suspender (corta sockets), reativar sem restaurar, exclusão lógica', async () => {
    const { app, boot, close, auth } = testApp()
    try {
      const created = await app.request(
        'http://localhost/api/platform/tenants',
        auth('user_synth_superadmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'clinic-demo-platform',
            name: 'Clínica Platform',
            ownerClerkUserId: 'user_synth_platform_owner',
          }),
        }),
      )
      expect(created.status).toBe(201)

      const patched = await app.request(
        'http://localhost/api/platform/tenants/clinic-demo-platform',
        auth('user_synth_superadmin', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Clínica Platform Editada' }),
        }),
      )
      expect(patched.status).toBe(200)
      expect((await patched.json() as { tenant: { name: string } }).tenant.name).toBe(
        'Clínica Platform Editada',
      )

      // Revoga membership antes de suspender para provar reativação.
      boot.db.run(
        `UPDATE tenant_memberships SET status = 'revoked', revoked_at = ?
         WHERE tenant_id = 'clinic-demo-platform' AND clerk_user_id = 'user_synth_platform_owner'`,
        Date.now(),
      )
      // Reatribui owner para o tenant poder existir operacionalmente; membership revogado auxiliar.
      await app.request(
        'http://localhost/api/platform/tenants/clinic-demo-platform/owners',
        auth('user_synth_superadmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clerkUserId: 'user_synth_owner_a' }),
        }),
      )

      const suspended = await app.request(
        'http://localhost/api/platform/tenants/clinic-demo-platform/suspend',
        auth('user_synth_superadmin', { method: 'POST' }),
      )
      expect(suspended.status).toBe(200)
      const susBody = (await suspended.json()) as {
        tenant: { status: string }
        doNotified: boolean
        closedConnections: string[]
      }
      expect(susBody.tenant.status).toBe('suspended')
      expect(susBody.doNotified).toBe(true)
      expect(susBody.closedConnections).toEqual(['ws_all'])

      // Operação clínica bloqueada enquanto suspenso.
      const blocked = await app.request(
        'http://localhost/api/tenants/clinic-demo-platform/context',
        auth('user_synth_owner_a'),
      )
      expect(blocked.status).toBe(403)

      const reactivated = await app.request(
        'http://localhost/api/platform/tenants/clinic-demo-platform/reactivate',
        auth('user_synth_superadmin', { method: 'POST' }),
      )
      expect(reactivated.status).toBe(200)
      const reaBody = (await reactivated.json()) as {
        preservedRevokedMemberships: number
        tenant: { status: string }
      }
      expect(reaBody.tenant.status).toBe('active')
      expect(reaBody.preservedRevokedMemberships).toBeGreaterThanOrEqual(1)
      expect(
        getMembership(boot.db, 'clinic-demo-platform', 'user_synth_platform_owner')?.status,
      ).toBe('revoked')

      const deleted = await app.request(
        'http://localhost/api/platform/tenants/clinic-demo-platform',
        auth('user_synth_superadmin', { method: 'DELETE' }),
      )
      expect(deleted.status).toBe(200)
      const delBody = (await deleted.json()) as {
        tenant: { status: string }
        deletionCommand: { status: string; id: string }
      }
      expect(delBody.tenant.status).toBe('pending_deletion')
      expect(delBody.deletionCommand.status).toBe('queued')
      expect(getTenant(boot.db, 'clinic-demo-platform')?.status).toBe('pending_deletion')

      const again = await app.request(
        'http://localhost/api/platform/tenants/clinic-demo-platform',
        auth('user_synth_superadmin', { method: 'DELETE' }),
      )
      expect(again.status).toBe(409)

      const audit = listAuditForTenant(boot.db, 'clinic-demo-platform')
      expect(audit.some((e) => e.action === 'tenant.pending_deletion')).toBe(true)
    } finally {
      close()
    }
  })

  it('gestão de owners exclusiva do superadmin; último owner protegido', async () => {
    const { app, close, auth } = testApp()
    try {
      const denied = await app.request(
        'http://localhost/api/platform/tenants/clinic-demo-b/owners',
        auth('user_synth_owner_b', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clerkUserId: 'user_synth_attendant_a' }),
        }),
      )
      expect(denied.status).toBe(403)

      const last = await app.request(
        'http://localhost/api/platform/tenants/clinic-demo-b/owners/user_synth_owner_b',
        auth('user_synth_superadmin', { method: 'DELETE' }),
      )
      expect(last.status).toBe(403)
      expect(await last.json()).toEqual({ error: 'last_owner_protected' })

      const promoted = await app.request(
        'http://localhost/api/platform/tenants/clinic-demo-b/owners',
        auth('user_synth_superadmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clerkUserId: 'user_synth_multi' }),
        }),
      )
      expect(promoted.status).toBe(201)

      const replaced = await app.request(
        'http://localhost/api/platform/tenants/clinic-demo-b/owners/replace',
        auth('user_synth_superadmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromClerkUserId: 'user_synth_owner_b',
            toClerkUserId: 'user_synth_multi',
          }),
        }),
      )
      expect(replaced.status).toBe(200)
    } finally {
      close()
    }
  })
})
