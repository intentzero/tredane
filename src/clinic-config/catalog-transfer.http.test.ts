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
import { createMemoryClinicConfigRegistry } from './gateway'
import type { CatalogTransferDocument } from '../clinic/config'

const BASE = 'http://localhost/api/tenants'
const OWNER = 'user_synth_owner_a'
const ATTENDANT = 'user_synth_attendant_a'
const OWNER_B = 'user_synth_owner_b'
const TENANT = 'clinic-demo-a'
const TENANT_B = 'clinic-demo-b'

function harness() {
  const admin = bootAdminDb()
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const boot = (tenantId: string) => {
    let b = clinics.get(tenantId)
    if (!b) {
      b = bootClinicDb()
      clinics.set(tenantId, b)
    }
    return b
  }
  const registry = createMemoryClinicConfigRegistry((tenantId) => {
    const b = boot(tenantId)
    return { db: b.db, clock: b.clock }
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
    clinicConfigGatewayFactory: (_env, tenantId) => registry(tenantId),
  })
  const req = (user: string, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', synthAuthHeader(user))
    if (init.body) headers.set('Content-Type', 'application/json')
    return app.request(`${BASE}/${path}`, { ...init, headers })
  }
  return {
    req,
    close: () => {
      for (const c of clinics.values()) c.close()
      admin.close()
    },
  }
}

async function seedMinimal(req: ReturnType<typeof harness>['req'], tenantId = TENANT) {
  const pro = await req(OWNER, `${tenantId}/config/resources`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'professional', name: 'Gi Fictícia' }),
  })
  expect(pro.status).toBe(201)
  const proId = ((await pro.json()) as { id: string }).id
  const svc = await req(OWNER, `${tenantId}/config/services`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Peeling fictício',
      durationMinutes: 45,
      bufferMinutes: 15,
      professionalIds: [proId],
      roomRequirement: { mode: 'none' },
      priceCents: 12000,
      synonyms: ['peeling facial'],
    }),
  })
  expect(svc.status).toBe(201)
  const serviceId = ((await svc.json()) as { id: string }).id
  return { proId, serviceId }
}

describe('HTTP — export/import catálogo (owner)', () => {
  it('attendant e owner de outro tenant são recusados; owner exporta com forma correcta', async () => {
    const h = harness()
    try {
      await seedMinimal(h.req)
      const denied = await h.req(ATTENDANT, `${TENANT}/config/catalog/export`, {
        method: 'POST',
        body: JSON.stringify({ services: true, professionals: true }),
      })
      expect(denied.status).toBe(403)

      const cross = await h.req(OWNER_B, `${TENANT}/config/catalog/export`, {
        method: 'POST',
        body: JSON.stringify({ services: true, professionals: false }),
      })
      expect(cross.status).toBe(403)

      const empty = await h.req(OWNER, `${TENANT}/config/catalog/export`, {
        method: 'POST',
        body: JSON.stringify({ services: false, professionals: false }),
      })
      expect(empty.status).toBe(400)
      const emptyBody = (await empty.json()) as { error: string }
      expect(emptyBody.error).toBe('catalog_transfer_empty_scopes')

      const ok = await h.req(OWNER, `${TENANT}/config/catalog/export`, {
        method: 'POST',
        body: JSON.stringify({ services: true, professionals: true }),
      })
      expect(ok.status).toBe(200)
      const doc = (await ok.json()) as CatalogTransferDocument
      expect(doc.format).toBe('tredane.clinic-catalog')
      expect(doc.version).toBe(1)
      expect(doc.sourceTenantId).toBe(TENANT)
      expect(doc.scopes).toEqual({ services: true, professionals: true })
      expect(doc.professionals).toHaveLength(1)
      expect(doc.professionals[0]?.name).toBe('Gi Fictícia')
      expect(doc.services).toHaveLength(1)
      expect(doc.services[0]?.name).toBe('Peeling fictício')
      expect(doc.services[0]?.synonyms).toContain('peeling facial')
      expect(doc.personalDataNote.length).toBeGreaterThan(10)
    } finally {
      h.close()
    }
  })

  it('import dry-run + apply; seleção vazia recusada; tenant isolado', async () => {
    const h = harness()
    try {
      await seedMinimal(h.req)
      const exported = await h.req(OWNER, `${TENANT}/config/catalog/export`, {
        method: 'POST',
        body: JSON.stringify({ services: true, professionals: true }),
      })
      const doc = (await exported.json()) as CatalogTransferDocument

      const emptyImport = await h.req(OWNER, `${TENANT}/config/catalog/import`, {
        method: 'POST',
        body: JSON.stringify({
          document: doc,
          dryRun: true,
          services: false,
          professionals: false,
        }),
      })
      expect(emptyImport.status).toBe(400)

      const attendantImport = await h.req(ATTENDANT, `${TENANT}/config/catalog/import`, {
        method: 'POST',
        body: JSON.stringify({ document: doc, dryRun: true }),
      })
      expect(attendantImport.status).toBe(403)

      const dry = await h.req(OWNER, `${TENANT}/config/catalog/import`, {
        method: 'POST',
        body: JSON.stringify({
          document: doc,
          dryRun: true,
          services: true,
          professionals: true,
        }),
      })
      expect(dry.status).toBe(200)
      const dryBody = (await dry.json()) as {
        dryRun: boolean
        items: Array<{ action: string; name: string }>
      }
      expect(dryBody.dryRun).toBe(true)
      expect(dryBody.items.every((i) => i.action === 'update')).toBe(true)

      // Clínica B começa vazia: import cria profissionais e serviços.
      const crossDenied = await h.req(OWNER, `${TENANT_B}/config/catalog/import`, {
        method: 'POST',
        body: JSON.stringify({ document: doc, dryRun: false, services: true, professionals: true }),
      })
      expect(crossDenied.status).toBe(403)

      const applyB = await h.req(OWNER_B, `${TENANT_B}/config/catalog/import`, {
        method: 'POST',
        body: JSON.stringify({
          document: doc,
          dryRun: false,
          services: true,
          professionals: true,
        }),
      })
      expect(applyB.status).toBe(200)
      const applied = (await applyB.json()) as {
        dryRun: boolean
        items: Array<{ action: string; scope: string }>
      }
      expect(applied.dryRun).toBe(false)
      expect(applied.items.some((i) => i.action === 'create' && i.scope === 'professionals')).toBe(
        true,
      )
      expect(applied.items.some((i) => i.action === 'create' && i.scope === 'services')).toBe(true)

      const snapB = await h.req(OWNER_B, `${TENANT_B}/config`)
      const bodyB = (await snapB.json()) as {
        services: Array<{ name: string }>
        resources: Array<{ kind: string; name: string }>
      }
      expect(bodyB.services.some((s) => s.name === 'Peeling fictício')).toBe(true)
      expect(
        bodyB.resources.some((r) => r.kind === 'professional' && r.name === 'Gi Fictícia'),
      ).toBe(true)
    } finally {
      h.close()
    }
  })

  it('export só profissionais não inclui serviços', async () => {
    const h = harness()
    try {
      await seedMinimal(h.req)
      const res = await h.req(OWNER, `${TENANT}/config/catalog/export`, {
        method: 'POST',
        body: JSON.stringify({ services: false, professionals: true }),
      })
      expect(res.status).toBe(200)
      const doc = (await res.json()) as CatalogTransferDocument
      expect(doc.services).toEqual([])
      expect(doc.professionals).toHaveLength(1)
      expect(doc.scopes).toEqual({ services: false, professionals: true })
    } finally {
      h.close()
    }
  })
})
