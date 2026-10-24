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
import { createMemoryPipelineRegistry } from './gateway'
import { createMemoryInboxRegistry } from '../inbox/gateway'

function testPipelineApp() {
  const admin = bootAdminDb()
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const getBoot = (tenantId: string) => {
    let boot = clinics.get(tenantId)
    if (!boot) {
      boot = bootClinicDb()
      clinics.set(tenantId, boot)
    }
    return { db: boot.db, clock: boot.clock }
  }
  const pipelineRegistry = createMemoryPipelineRegistry(getBoot)
  const inboxRegistry = createMemoryInboxRegistry(getBoot)
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
    pipelineGatewayFactory: (_env, tenantId) => pipelineRegistry(tenantId),
    inboxGatewayFactory: (_env, tenantId) => inboxRegistry(tenantId),
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

describe('HTTP — Acompanhamento (#30)', () => {
  it('owner e attendant listam seed; mover atualiza; B não vê A', async () => {
    const { app, close, auth } = testPipelineApp()
    try {
      const seed = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/pipeline/seed-demo',
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      )
      expect(seed.status).toBe(200)
      const seedBody = (await seed.json()) as {
        seeded: boolean
        val02Fixtures: { hypothesis: string }
      }
      expect(seedBody.val02Fixtures.hypothesis).toBe('VAL-02')

      const listAtt = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/pipeline/opportunities',
        auth('user_synth_attendant_a'),
      )
      expect(listAtt.status).toBe(200)
      const bodyAtt = (await listAtt.json()) as {
        opportunities: Array<{
          id: string
          stage: string
          missingAppointment?: boolean
        }>
        counts: Array<{ stage: string; count: number }>
      }
      expect(bodyAtt.opportunities.length).toBeGreaterThan(0)
      expect(bodyAtt.counts.some((c) => c.stage === 'agendado' && c.count >= 1)).toBe(
        true,
      )
      const withoutApt = bodyAtt.opportunities.find((o) => o.id === 'opp_seed_beatriz')
      expect(withoutApt?.missingAppointment).toBe(true)

      const listOwner = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/pipeline/opportunities?stage=em_atendimento',
        auth('user_synth_owner_a'),
      )
      expect(listOwner.status).toBe(200)

      const juliana = bodyAtt.opportunities.find((o) => o.id === 'opp_seed_juliana')!
      const detailBefore = await app.request(
        `http://localhost/api/tenants/clinic-demo-a/pipeline/opportunities/${juliana.id}`,
        auth('user_synth_attendant_a'),
      )
      const beforeJson = (await detailBefore.json()) as {
        opportunity: { updatedAt: number; stage: string; history: unknown[] }
      }

      const move = await app.request(
        `http://localhost/api/tenants/clinic-demo-a/pipeline/opportunities/${juliana.id}/move`,
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toStage: 'horario_proposto',
            expectedUpdatedAt: beforeJson.opportunity.updatedAt,
          }),
        }),
      )
      expect(move.status).toBe(200)
      const moved = (await move.json()) as {
        opportunity: { stage: string; history: Array<{ toStage: string }> }
      }
      expect(moved.opportunity.stage).toBe('horario_proposto')
      expect(
        moved.opportunity.history.some((h) => h.toStage === 'horario_proposto'),
      ).toBe(true)

      const stale = await app.request(
        `http://localhost/api/tenants/clinic-demo-a/pipeline/opportunities/${juliana.id}/move`,
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toStage: 'agendado',
            expectedUpdatedAt: beforeJson.opportunity.updatedAt,
          }),
        }),
      )
      expect(stale.status).toBe(409)

      const cross = await app.request(
        `http://localhost/api/tenants/clinic-demo-b/pipeline/opportunities/${juliana.id}`,
        auth('user_synth_owner_b'),
      )
      expect(cross.status).toBe(404)

      const denied = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/pipeline/opportunities',
        auth('user_synth_owner_b'),
      )
      expect(denied.status).toBe(403)
    } finally {
      close()
    }
  })
})
