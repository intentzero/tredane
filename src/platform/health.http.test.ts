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
import { createControllableClock } from '../db/clock'
import { refreshTenantHealth } from '../ops/health-summary'

const SUPER = 'user_synth_superadmin'
const T0 = 3_100_000_000_000

const snap = (over: Record<string, unknown> = {}) => ({
  tenantId: 'x',
  schemaVersion: 41,
  schemaReady: true,
  pendingOutbox: 0,
  failedOutbox: 0,
  uncertainOutbound: 0,
  llmJobsOpen: 2,
  llmJobsFailed1h: 0,
  ...over,
})

function testApp(stub: (tenantId: string) => Promise<unknown> = async () => snap()) {
  const boot = bootAdminDb()
  const clock = createControllableClock(T0)
  const calls: string[] = []
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(boot.db),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => boot.db,
    clockFactory: () => clock,
    ops: {
      clinicStubFactory: (_env, tenantId) => ({
        getOpsSnapshot: async () => {
          calls.push(tenantId)
          return (await stub(tenantId)) as never
        },
        ping: async (tid: string) => ({ ok: true as const, tenantId: tid, value: 'pong' }),
      }),
    },
  })
  const call = (user: string, path: string, method = 'GET') =>
    app.request(`http://localhost${path}`, { method, headers: { Authorization: synthAuthHeader(user) } })
  return { app, boot, clock, calls, call, db: asyncFromSync(boot.db), close: boot.close }
}

type Clinic = {
  tenantId: string
  name: string
  situation: string
  stale: boolean
  tenantStatus: string
  alerts: Array<{ kind: string }>
  counts: Record<string, unknown> | null
  readAt: number | null
}
type Overview = {
  summaryAt: number | null
  refreshIntervalMs: number
  totals: Record<string, number>
  clinics: Clinic[]
}

describe('HTTP — saúde na Platform Admin (#833, DEC-193)', () => {
  it('a visão global lê o resumo gravado e não consulta o Durable Object', async () => {
    const ctx = testApp()
    try {
      await refreshTenantHealth(ctx.db, 'clinic-demo-a', async () => snap({ failedOutbox: 2 }), T0)
      ctx.calls.length = 0
      const res = await ctx.call(SUPER, '/api/platform/health')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Overview
      expect(ctx.calls).toEqual([])
      const a = body.clinics.find((c) => c.tenantId === 'clinic-demo-a')!
      expect(a).toMatchObject({ situation: 'attention', stale: false, readAt: T0 })
      expect(a.counts).toMatchObject({ failedOutbox: 2, llmJobsOpen: 2, schemaVersion: 41 })
      expect(body.summaryAt).toBe(T0)
      expect(body.refreshIntervalMs).toBe(600_000)
      expect(body.totals).toMatchObject({ attention: 1, llmJobsOpen: 2 })
      // Clínicas sem leitura aparecem como «sem dados».
      const others = body.clinics.filter((c) => c.tenantId !== 'clinic-demo-a' && c.tenantStatus === 'active')
      expect(others.length).toBeGreaterThan(0)
      expect(others.every((c) => c.situation === 'no_data' && c.counts === null)).toBe(true)
      expect(JSON.stringify(body)).not.toMatch(/mensagem|message_body|phone|token/i)
    } finally {
      ctx.close()
    }
  })

  it('clínica suspensa aparece «inativa» e não conta nos totais', async () => {
    const ctx = testApp()
    try {
      await refreshTenantHealth(ctx.db, 'clinic-demo-b', async () => snap(), T0)
      ctx.boot.db.run(`UPDATE tenants SET status = 'suspended' WHERE id = 'clinic-demo-b'`)
      const body = (await (await ctx.call(SUPER, '/api/platform/health')).json()) as Overview
      const b = body.clinics.find((c) => c.tenantId === 'clinic-demo-b')!
      expect(b.situation).toBe('inactive')
      expect(b.counts).not.toBeNull()
      expect(body.totals.normal).toBe(0)
    } finally {
      ctx.close()
    }
  })

  it('leitura falhada marca «stale» e conta como sem resposta', async () => {
    const ctx = testApp()
    try {
      await refreshTenantHealth(ctx.db, 'clinic-demo-a', async () => snap(), T0)
      await refreshTenantHealth(ctx.db, 'clinic-demo-a', async () => { throw new Error('x') }, T0 + 600_000)
      const body = (await (await ctx.call(SUPER, '/api/platform/health')).json()) as Overview
      expect(body.clinics.find((c) => c.tenantId === 'clinic-demo-a')).toMatchObject({ stale: true, situation: 'normal' })
      expect(body.totals.unreachable).toBe(1)
    } finally {
      ctx.close()
    }
  })

  it('«atualizar» relê só esta clínica, grava e devolve a saúde', async () => {
    const ctx = testApp(async () => snap({ pendingOutbox: 12 }))
    try {
      const res = await ctx.call(SUPER, '/api/platform/tenants/clinic-demo-a/health/refresh', 'POST')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { health: Clinic }
      expect(ctx.calls).toEqual(['clinic-demo-a'])
      expect(body.health).toMatchObject({ situation: 'attention', readAt: T0 })
      expect(body.health.alerts.map((a) => a.kind)).toEqual(['outbox.stale'])
      // O resumo ficou gravado: a visão global já o mostra sem tocar no DO.
      ctx.calls.length = 0
      const global = (await (await ctx.call(SUPER, '/api/platform/health')).json()) as Overview
      expect(global.clinics.find((c) => c.tenantId === 'clinic-demo-a')?.situation).toBe('attention')
      expect(ctx.calls).toEqual([])
    } finally {
      ctx.close()
    }
  })

  it('«atualizar» com o DO em baixo devolve 200 com a clínica marcada sem resposta', async () => {
    const ctx = testApp(async () => { throw new Error('do_down') })
    try {
      const res = await ctx.call(SUPER, '/api/platform/tenants/clinic-demo-a/health/refresh', 'POST')
      expect(res.status).toBe(200)
      expect(((await res.json()) as { health: Clinic }).health).toMatchObject({ stale: true, situation: 'no_data' })
    } finally {
      ctx.close()
    }
  })

  it('«atualizar» recusa clínica suspensa (403) e inexistente (404) sem tocar no DO', async () => {
    const ctx = testApp()
    try {
      ctx.boot.db.run(`UPDATE tenants SET status = 'suspended' WHERE id = 'clinic-demo-b'`)
      expect((await ctx.call(SUPER, '/api/platform/tenants/clinic-demo-b/health/refresh', 'POST')).status).toBe(403)
      expect((await ctx.call(SUPER, '/api/platform/tenants/nao-existe/health/refresh', 'POST')).status).toBe(404)
      expect(ctx.calls).toEqual([])
    } finally {
      ctx.close()
    }
  })

  it('GET por clínica devolve a saúde; 404 se não existe', async () => {
    const ctx = testApp()
    try {
      await refreshTenantHealth(ctx.db, 'clinic-demo-a', async () => snap({ schemaReady: false }), T0)
      const ok = await ctx.call(SUPER, '/api/platform/tenants/clinic-demo-a/health')
      expect(ok.status).toBe(200)
      expect(((await ok.json()) as { health: Clinic }).health).toMatchObject({ situation: 'critical' })
      expect((await ctx.call(SUPER, '/api/platform/tenants/nao-existe/health')).status).toBe(404)
    } finally {
      ctx.close()
    }
  })

  it('só o superadmin: owners e flags não booleanas recebem 403', async () => {
    const ctx = testApp()
    try {
      for (const user of ['user_synth_owner_a', 'user_synth_string_super', 'user_synth_public_super']) {
        for (const [path, method] of [
          ['/api/platform/health', 'GET'],
          ['/api/platform/tenants/clinic-demo-a/health', 'GET'],
          ['/api/platform/tenants/clinic-demo-a/health/refresh', 'POST'],
        ] as const) {
          expect((await ctx.call(user, path, method)).status, `${user} ${path}`).toBe(403)
        }
      }
      expect(ctx.calls).toEqual([])
    } finally {
      ctx.close()
    }
  })
})
