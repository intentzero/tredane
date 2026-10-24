import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  createSyntheticVerifiedEmailReader,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import { CLINIC_SCHEMA_VERSION } from '../clinic/constants'
import type { OpsClinicSnapshot } from './metrics'

function snapshot(tenantId: string, overrides: Partial<OpsClinicSnapshot> = {}): OpsClinicSnapshot {
  return {
    tenantId,
    schemaVersion: CLINIC_SCHEMA_VERSION,
    schemaReady: true,
    pendingOutbox: 0,
    failedOutbox: 0,
    uncertainOutbound: 0,
    contactCount: tenantId === 'clinic-demo-a' ? 2 : 1,
    messageCount: tenantId === 'clinic-demo-a' ? 5 : 3,
    appointmentCount: 0,
    attachmentMetaCount: 0,
    ...overrides,
  }
}

function testOpsApp() {
  const boot = bootAdminDb()
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({
      authorizedParties: ['http://localhost:5173'],
    }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(boot.db),
    verifiedEmails: createSyntheticVerifiedEmailReader(),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => boot.db,
    ops: {
      syncAdminDbFactory: () => boot.db,
      clinicStubFactory: (_env, tenantId) => ({
        getOpsSnapshot: async () => snapshot(tenantId),
        ping: async (tid) => ({ ok: true as const, tenantId: tid, value: tid }),
      }),
      attachmentsBucketFactory: () => null,
    },
  })
  const env = {
    ENVIRONMENT: 'development',
    AUTH_MODE: 'synthetic',
  } as never
  return {
    app,
    env,
    close: boot.close,
    auth: (userId: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', synthAuthHeader(userId))
      headers.set('Origin', 'http://localhost:5173')
      return { ...init, headers }
    },
  }
}

describe('ops HTTP (#44)', () => {
  it('catálogo público e scrub-check sem PII', async () => {
    const ctx = testOpsApp()
    try {
      const catalog = await ctx.app.request(
        'http://localhost/api/f6/ops/catalog',
        {},
        ctx.env,
      )
      expect(catalog.status).toBe(200)
      const body = (await catalog.json()) as {
        budgets: unknown[]
        alertKinds: string[]
        logRetention: { status: string }
      }
      expect(body.budgets.length).toBeGreaterThan(0)
      expect(body.alertKinds).toContain('dlq.depth')
      expect(body.logRetention.status).toBe('em_aberto')

      const scrub = await ctx.app.request(
        'http://localhost/api/f6/ops/log/scrub-check',
        ctx.auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
        ctx.env,
      )
      expect(scrub.status).toBe(200)
      const scrubBody = (await scrub.json()) as {
        safe: boolean
        line: string
        scrubbed: Record<string, unknown>
      }
      expect(scrubBody.safe).toBe(true)
      expect(scrubBody.line).not.toContain('mensagem pessoal')
      expect(scrubBody.scrubbed.body).toBeUndefined()
      expect(scrubBody.scrubbed.waId).toBeUndefined()
    } finally {
      ctx.close()
    }
  })

  it('smoke, load e recovery rehearsal com isolamento A/B', async () => {
    const ctx = testOpsApp()
    try {
      const smoke = await ctx.app.request(
        'http://localhost/api/f6/ops/smoke',
        ctx.auth('user_synth_superadmin'),
        ctx.env,
      )
      expect(smoke.status).toBe(200)
      const smokeBody = (await smoke.json()) as { ok: boolean }
      expect(smokeBody.ok).toBe(true)

      const load = await ctx.app.request(
        'http://localhost/api/f6/ops/load',
        ctx.auth('user_synth_superadmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ iterations: 3 }),
        }),
        ctx.env,
      )
      expect(load.status).toBe(200)
      const loadBody = (await load.json()) as {
        withinProposedBudgets: boolean
        clinicSnapshots: { tenantId: string }[]
      }
      expect(loadBody.clinicSnapshots.map((s) => s.tenantId).sort()).toEqual([
        'clinic-demo-a',
        'clinic-demo-b',
      ])
      expect(loadBody.withinProposedBudgets).toBe(true)

      const recovery = await ctx.app.request(
        'http://localhost/api/f6/ops/recovery/rehearse',
        ctx.auth('user_synth_superadmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
        ctx.env,
      )
      expect(recovery.status).toBe(200)
      const recBody = (await recovery.json()) as {
        ok: boolean
        report: { isolationOk: boolean; openGates: string[] }
      }
      expect(recBody.ok).toBe(true)
      expect(recBody.report.isolationOk).toBe(true)
      expect(recBody.report.openGates.length).toBeGreaterThan(0)
    } finally {
      ctx.close()
    }
  })

  it('inject alerta sintético; secrets inventory só superadmin', async () => {
    const ctx = testOpsApp()
    try {
      const denied = await ctx.app.request(
        'http://localhost/api/f6/ops/secrets-inventory',
        ctx.auth('user_synth_owner_a'),
        ctx.env,
      )
      expect([401, 403]).toContain(denied.status)

      const inv = await ctx.app.request(
        'http://localhost/api/f6/ops/secrets-inventory',
        ctx.auth('user_synth_superadmin'),
        ctx.env,
      )
      expect(inv.status).toBe(200)

      const injected = await ctx.app.request(
        'http://localhost/api/f6/ops/alerts/inject',
        ctx.auth('user_synth_superadmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'dlq.depth',
            tenantId: 'clinic-demo-a',
            fields: { dlqDepth: 2 },
          }),
        }),
        ctx.env,
      )
      expect(injected.status).toBe(200)
      const injBody = (await injected.json()) as { ok: boolean; kind: string }
      expect(injBody.ok).toBe(true)
      expect(injBody.kind).toBe('dlq.depth')
    } finally {
      ctx.close()
    }
  })
})
