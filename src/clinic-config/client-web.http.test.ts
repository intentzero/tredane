/**
 * HTTP — interruptor da página web da cliente (DEC-199). Só a owner; attendant 403; cross-tenant 403.
 */
import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import { createSyntheticAuthorityReader, createSyntheticSessionAuthenticator, synthAuthHeader, type AuthServices } from '../auth'
import { bootClinicDb } from '../clinic/test-db'
import { createMemoryClinicConfigRegistry } from './gateway'

function testApp() {
  const admin = bootAdminDb()
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const registry = createMemoryClinicConfigRegistry((tenantId) => {
    let boot = clinics.get(tenantId)
    if (!boot) {
      boot = bootClinicDb()
      clinics.set(tenantId, boot)
    }
    return { db: boot.db, clock: boot.clock }
  })
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(admin.db),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => admin.db,
    clinicConfigGatewayFactory: (_env, tenantId) => registry(tenantId),
  })
  const auth = (userId: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', synthAuthHeader(userId))
    return { ...init, headers }
  }
  return { app, auth, close: () => { for (const c of clinics.values()) c.close(); admin.close() } }
}

const url = (tenant = 'clinic-demo-a') => `http://localhost/api/tenants/${tenant}/config/client-web`

describe('HTTP — interruptor da página web da cliente', () => {
  it('começa desligado; a owner liga e desliga', async () => {
    const { app, auth, close } = testApp()
    try {
      const get0 = await app.request(url(), auth('user_synth_owner_a'))
      expect(get0.status).toBe(200)
      expect(await get0.json()).toMatchObject({ enabled: false })
      const on = await app.request(url(), auth('user_synth_owner_a', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) }))
      expect(on.status).toBe(200)
      expect(await on.json()).toMatchObject({ enabled: true })
      expect(await (await app.request(url(), auth('user_synth_owner_a'))).json()).toMatchObject({ enabled: true })
      const off = await app.request(url(), auth('user_synth_owner_a', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) }))
      expect(await off.json()).toMatchObject({ enabled: false })
    } finally {
      close()
    }
  })

  it('a atendente não lê nem altera (403) e sem sessão dá 401', async () => {
    const { app, auth, close } = testApp()
    try {
      expect((await app.request(url(), auth('user_synth_attendant_a'))).status).toBe(403)
      expect((await app.request(url(), auth('user_synth_attendant_a', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) }))).status).toBe(403)
      expect((await app.request(url())).status).toBe(401)
    } finally {
      close()
    }
  })

  it('outra clínica é 403 e o corpo tem de ser booleano', async () => {
    const { app, auth, close } = testApp()
    try {
      expect((await app.request(url('clinic-demo-b'), auth('user_synth_owner_a'))).status).toBe(403)
      const bad = await app.request(url(), auth('user_synth_owner_a', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: 'sim' }) }))
      expect(bad.status).toBe(400)
    } finally {
      close()
    }
  })
})
