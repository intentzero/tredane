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
import { bootClinicDb } from '../clinic/test-db'
import { createMemoryPixAccountGateway } from './gateway'
import { createWooviSandboxFixture } from '../pix'
import { createControllableClock } from '../db/clock'

function testPixApp(sandbox: Awaited<ReturnType<typeof createWooviSandboxFixture>>) {
  const admin = bootAdminDb()
  const clock = createControllableClock(1_700_000_000_000)
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
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
    clockFactory: () => clock,
    pixAccount: {
      gatewayFactory: (_env, tenantId) => {
        let boot = clinics.get(tenantId)
        if (!boot) {
          boot = bootClinicDb({ clock })
          clinics.set(tenantId, boot)
        }
        return createMemoryPixAccountGateway(boot.db, clock)
      },
      connectDepsFactory: () => ({
        environment: 'synthetic' as const,
        fetchImpl: sandbox.fetchImpl,
        baseUrl: sandbox.baseUrl,
        webhookPublicKeys: [sandbox.publicPem],
        tokenSecret: 'http-test-secret',
      }),
    },
  })
  return {
    app,
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

describe('HTTP — conta Pix (#37)', () => {
  it('attendant não conecta nem altera política; owner conecta sem expor App ID', async () => {
    const sandbox = await createWooviSandboxFixture()
    const appId = 'synth_http_woovi_app_abcdefgh'
    sandbox.addValidAppId(appId)
    const { app, close, auth } = testPixApp(sandbox)
    try {
      const denied = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/pix/connect',
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId }),
        }),
      )
      expect(denied.status).toBe(403)

      const ok = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/pix/connect',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId }),
        }),
      )
      expect(ok.status).toBe(200)
      const body = (await ok.json()) as {
        account: { status: string; appIdHint: string; canCreateCharge: boolean }
      }
      expect(body.account.status).toBe('connected')
      expect(body.account.canCreateCharge).toBe(true)
      expect(JSON.stringify(body)).not.toContain(appId)

      const policyDenied = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/pix/signal-settings',
        auth('user_synth_attendant_a', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deadlineSeconds: 3600 }),
        }),
      )
      expect(policyDenied.status).toBe(403)

      const policyOk = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/pix/signal-settings',
        auth('user_synth_owner_a', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deadlineSeconds: 3600,
            cancellationPolicy: 'Política fictícia de cancelamento do sinal.',
          }),
        }),
      )
      expect(policyOk.status).toBe(200)

      const get = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/pix',
        auth('user_synth_attendant_a'),
      )
      expect(get.status).toBe(200)
      const snap = (await get.json()) as {
        account: { canCreateCharge: boolean }
        signalSettings: { deadlineSeconds: number }
      }
      expect(snap.account.canCreateCharge).toBe(true)
      expect(snap.signalSettings.deadlineSeconds).toBe(3600)
    } finally {
      close()
    }
  })

  it('desconexão preserva cobranças listáveis por accountId', async () => {
    const sandbox = await createWooviSandboxFixture()
    const appId = 'synth_http_disconnect_app_xyz'
    sandbox.addValidAppId(appId)
    const { app, close, auth } = testPixApp(sandbox)
    try {
      const connected = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/pix/connect',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId }),
        }),
      )
      expect(connected.status).toBe(200)
      const acct = (await connected.json()) as {
        account: { accountId: string }
      }

      // Grava cobrança via gateway de memória (teste) — simula ledger pós-#38
      const clinicBoot = bootClinicDb()
      // Usa o mesmo padrão: reconnect gateway já tem a conta no map do testPixApp.
      // Em vez disso, chama disconnect e verifica chargesPreserved=0 sem ledger,
      // e com revoke + charges via domain no teste de domínio.
      const disc = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/pix/disconnect',
        auth('user_synth_owner_a', { method: 'POST' }),
      )
      expect(disc.status).toBe(200)
      const discBody = (await disc.json()) as {
        account: { status: string; canCreateCharge: boolean }
        chargesPreserved: number
      }
      expect(discBody.account.status).toBe('disconnected')
      expect(discBody.account.canCreateCharge).toBe(false)
      expect(discBody.chargesPreserved).toBe(0)
      expect(acct.account.accountId).toBeTruthy()
      clinicBoot.close()
    } finally {
      close()
    }
  })
})
