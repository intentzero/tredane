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
import { recordUnmatchedTerm } from '../clinic/config/unmatched-terms'
import { createMemoryClinicConfigRegistry } from './gateway'

function testApp() {
  const admin = bootAdminDb()
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const clinic = (tenantId: string) => {
    let boot = clinics.get(tenantId)
    if (!boot) {
      boot = bootClinicDb()
      clinics.set(tenantId, boot)
    }
    return boot
  }
  const registry = createMemoryClinicConfigRegistry((tenantId) => {
    const boot = clinic(tenantId)
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
  const req = (user: string, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', synthAuthHeader(user))
    if (init.body) headers.set('Content-Type', 'application/json')
    return app.request(`http://localhost/api/tenants/clinic-demo-a/config${path}`, { ...init, headers })
  }
  return {
    clinic,
    req,
    close: () => {
      for (const c of clinics.values()) c.close()
      admin.close()
    },
  }
}

describe('HTTP — sugestões de sinónimo (DEC-141)', () => {
  it('só a owner lista, grava e descarta; a atendente recebe 403', async () => {
    const { clinic, req, close } = testApp()
    try {
      const created = await req('user_synth_owner_a', '/services', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Depilação',
          durationMinutes: 30,
          bufferMinutes: 0,
          professionalIds: [],
          roomRequirement: { mode: 'none' },
        }),
      })
      expect(created.status).toBe(201)
      const dep = (await created.json()) as { id: string }
      const boot = clinic('clinic-demo-a')
      recordUnmatchedTerm(boot.db, 'clinic-demo-a', 'depilar', boot.clock)
      recordUnmatchedTerm(boot.db, 'clinic-demo-a', 'sobrancelha', boot.clock)

      expect((await req('user_synth_attendant_a', '/unmatched-terms')).status).toBe(403)
      const list = await req('user_synth_owner_a', '/unmatched-terms')
      expect(list.status).toBe(200)
      const { items } = (await list.json()) as {
        items: Array<{ id: string; term: string; suggestedServiceId: string | null }>
      }
      const depilar = items.find((i) => i.term === 'depilar')!
      const sobrancelha = items.find((i) => i.term === 'sobrancelha')!
      expect(depilar.suggestedServiceId).toBe(dep.id)

      const accept = (user: string, body: unknown) =>
        req(user, `/unmatched-terms/${depilar.id}/accept`, {
          method: 'POST',
          body: JSON.stringify(body),
        })
      expect((await accept('user_synth_attendant_a', { serviceId: dep.id })).status).toBe(403)
      expect((await accept('user_synth_owner_a', {})).status).toBe(400)
      const ok = await accept('user_synth_owner_a', { serviceId: dep.id })
      expect(ok.status).toBe(200)
      expect(((await ok.json()) as { synonyms: string[] }).synonyms).toEqual(['depilar'])
      expect((await accept('user_synth_owner_a', { serviceId: dep.id })).status).toBe(400)

      const dismiss = (user: string) =>
        req(user, `/unmatched-terms/${sobrancelha.id}/dismiss`, { method: 'POST' })
      expect((await dismiss('user_synth_attendant_a')).status).toBe(403)
      expect((await dismiss('user_synth_owner_a')).status).toBe(200)
      expect((await req('user_synth_owner_a', '/unmatched-terms/nao-existe/dismiss', { method: 'POST' })).status).toBe(404)

      const after = (await (await req('user_synth_owner_a', '/unmatched-terms')).json()) as { items: unknown[] }
      expect(after.items).toEqual([])
    } finally {
      close()
    }
  })
})
