import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import {
  assessHealth,
  getHealth,
  listHealth,
  refreshAllHealth,
  refreshTenantHealth,
  type HealthSummaryRow,
} from './health-summary'

const NOW = 3_100_000_000_000
const snap = (over: Record<string, unknown> = {}) => ({
  tenantId: 'x',
  schemaVersion: 41,
  schemaReady: true,
  pendingOutbox: 0,
  failedOutbox: 0,
  uncertainOutbound: 0,
  llmJobsOpen: 0,
  llmJobsFailed1h: 0,
  contactCount: 12,
  messageCount: 340,
  appointmentCount: 7,
  attachmentMetaCount: 5,
  ...over,
})
const row = (over: Partial<HealthSummaryRow> = {}): HealthSummaryRow => ({
  tenantId: 'x',
  readAt: NOW,
  lastOkAt: NOW,
  status: 'ok',
  schemaVersion: 41,
  schemaReady: true,
  pendingOutbox: 0,
  failedOutbox: 0,
  uncertainOutbound: 0,
  llmJobsOpen: 0,
  llmJobsFailed1h: 0,
  contactCount: null,
  messageCount: null,
  appointmentCount: null,
  attachmentCount: null,
  ...over,
})

describe('assessHealth (limiares Propostos, #833)', () => {
  it('sem leitura boa → sem dados; com leitura sem problemas → normal', () => {
    expect(assessHealth(null, 'connected').situation).toBe('no_data')
    expect(assessHealth(row({ lastOkAt: null, status: 'unreachable' }), 'connected')).toMatchObject({
      situation: 'no_data',
      stale: true,
    })
    expect(assessHealth(row(), 'connected')).toEqual({ situation: 'normal', alerts: [], stale: false })
    // Sem WhatsApp ligado não é problema de saúde.
    expect(assessHealth(row(), 'not_connected').situation).toBe('normal')
  })

  it('envios falhados, incertos ou jobs de IA falhados dão «atenção»', () => {
    expect(assessHealth(row({ failedOutbox: 1 }), 'connected').situation).toBe('attention')
    expect(assessHealth(row({ uncertainOutbound: 1 }), 'connected').situation).toBe('attention')
    expect(assessHealth(row({ llmJobsFailed1h: 1 }), 'connected').situation).toBe('attention')
  })

  it('alertas só aparecem nos limiares reais e trazem valor e limiar', () => {
    const below = assessHealth(row({ pendingOutbox: 9, uncertainOutbound: 4, llmJobsFailed1h: 9 }), 'connected')
    expect(below.alerts).toEqual([])
    const above = assessHealth(row({ pendingOutbox: 10, uncertainOutbound: 5, llmJobsFailed1h: 10 }), 'connected')
    expect(above.alerts.map((a) => [a.kind, a.value, a.threshold])).toEqual([
      ['outbox.stale', 10, 10],
      ['outbound.uncertain', 5, 5],
      ['ai.failure', 10, 10],
    ])
    expect(above.situation).toBe('attention')
  })

  it('crítico: schema fora de versão ou WhatsApp interrompido', () => {
    const schema = assessHealth(row({ schemaReady: false }), 'connected')
    expect(schema.situation).toBe('critical')
    expect(schema.alerts.map((a) => a.kind)).toContain('schema.mismatch')
    expect(assessHealth(row(), 'error').situation).toBe('critical')
  })

  it('leitura falhada mantém os números da última boa e marca «stale»', () => {
    expect(assessHealth(row({ status: 'unreachable', failedOutbox: 2 }), 'connected')).toMatchObject({
      situation: 'attention',
      stale: true,
    })
  })
})

describe('refresh e leitura do resumo (DEC-193)', () => {
  it('grava só contagens e estados e lê juntando nome e WhatsApp', async () => {
    const boot = bootAdminDb()
    try {
      const db = asyncFromSync(boot.db)
      const out = await refreshTenantHealth(db, 'clinic-demo-a', async () => snap({ failedOutbox: 3 }), NOW)
      expect(out).toBe('ok')
      const r = (await getHealth(db, 'clinic-demo-a'))!
      expect(r.summary).toMatchObject({ status: 'ok', failedOutbox: 3, schemaVersion: 41, schemaReady: true, readAt: NOW, lastOkAt: NOW })
      expect(r.name).toBeTruthy()
      expect(r.whatsappStatus).toBe('not_connected')
      // Volume (Q-PA-04): só números.
      expect(r.summary).toMatchObject({ contactCount: 12, messageCount: 340, appointmentCount: 7, attachmentCount: 5 })
      // Nada além de contagens e estados: todo o valor do resumo é número, booleano ou nulo (salvo o id e o estado).
      const rest: Record<string, unknown> = { ...r.summary! }
      delete rest.tenantId
      delete rest.status
      expect(Object.values(rest).every((v) => v === null || typeof v === 'number' || typeof v === 'boolean')).toBe(true)
      expect(JSON.stringify(r)).not.toMatch(/phone|token|body|text/i)
      expect(await getHealth(db, 'nao-existe')).toBeNull()
    } finally {
      boot.close()
    }
  })

  it('falha ou timeout marcam «unreachable» sem apagar a última leitura boa', async () => {
    const boot = bootAdminDb()
    try {
      const db = asyncFromSync(boot.db)
      await refreshTenantHealth(db, 'clinic-demo-a', async () => snap({ pendingOutbox: 4 }), NOW)
      const failed = await refreshTenantHealth(db, 'clinic-demo-a', async () => { throw new Error('do_down') }, NOW + 600_000)
      expect(failed).toBe('unreachable')
      let r = (await getHealth(db, 'clinic-demo-a'))!.summary!
      expect(r).toMatchObject({ status: 'unreachable', pendingOutbox: 4, lastOkAt: NOW, readAt: NOW + 600_000 })
      const slow = await refreshTenantHealth(db, 'clinic-demo-a', () => new Promise(() => undefined), NOW + 1_200_000, 20)
      expect(slow).toBe('unreachable')
      r = (await getHealth(db, 'clinic-demo-a'))!.summary!
      expect(r.lastOkAt).toBe(NOW)
      // Recupera: a leitura seguinte volta a «ok».
      await refreshTenantHealth(db, 'clinic-demo-a', async () => snap(), NOW + 1_800_000)
      expect((await getHealth(db, 'clinic-demo-a'))!.summary).toMatchObject({ status: 'ok', pendingOutbox: 0 })
    } finally {
      boot.close()
    }
  })

  it('um snapshot sem volume (DO antigo) guarda nulos e a leitura seguinte preenche', async () => {
    const boot = bootAdminDb()
    try {
      const db = asyncFromSync(boot.db)
      const old: Record<string, unknown> & { tenantId: string } = snap()
      for (const k of ['contactCount', 'messageCount', 'appointmentCount', 'attachmentMetaCount']) delete old[k]
      await refreshTenantHealth(db, 'clinic-demo-a', async () => old, NOW)
      expect((await getHealth(db, 'clinic-demo-a'))!.summary).toMatchObject({ contactCount: null, messageCount: null })
      await refreshTenantHealth(db, 'clinic-demo-a', async () => snap({ messageCount: 9 }), NOW + 600_000)
      expect((await getHealth(db, 'clinic-demo-a'))!.summary).toMatchObject({ messageCount: 9, contactCount: 12 })
    } finally {
      boot.close()
    }
  })

  it('uma clínica nova que nunca respondeu fica «unreachable» sem números', async () => {
    const boot = bootAdminDb()
    try {
      const db = asyncFromSync(boot.db)
      await refreshTenantHealth(db, 'clinic-demo-a', async () => { throw new Error('x') }, NOW)
      expect((await getHealth(db, 'clinic-demo-a'))!.summary).toMatchObject({ status: 'unreachable', lastOkAt: null, pendingOutbox: null })
    } finally {
      boot.close()
    }
  })

  it('refreshAll só lê clínicas ativas e uma falha não pára as outras', async () => {
    const boot = bootAdminDb()
    try {
      const db = asyncFromSync(boot.db)
      boot.db.run(`UPDATE tenants SET status = 'suspended' WHERE id = 'clinic-demo-b'`)
      const read: string[] = []
      const result = await refreshAllHealth(
        db,
        async (id) => {
          read.push(id)
          if (id === 'clinic-demo-a') throw new Error('do_down')
          return snap()
        },
        NOW,
      )
      expect(read).not.toContain('clinic-demo-b')
      expect(result.unreachable).toBeGreaterThanOrEqual(1)
      const all = await listHealth(db)
      expect(all.find((x) => x.tenantId === 'clinic-demo-b')?.summary).toBeNull()
      expect(all.find((x) => x.tenantId === 'clinic-demo-a')?.summary?.status).toBe('unreachable')
      const names = all.map((x) => x.name.toLowerCase())
      expect(names).toEqual([...names].sort())
    } finally {
      boot.close()
    }
  })
})

describe('cron de saúde', () => {
  it('o cron do código existe em todos os ambientes de wrangler.jsonc', async () => {
    const { readFileSync } = await import('node:fs')
    const { HEALTH_CRON } = await import('./health-cron')
    const wrangler = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8')
    const lines = wrangler.split('\n').filter((l) => /"crons"\s*:/.test(l))
    // raiz, staging e produção
    expect(lines).toHaveLength(3)
    for (const l of lines) {
      expect(l).toContain(`"${HEALTH_CRON}"`)
      // O purge diário (DEC-159) continua lá.
      expect(l).toContain('"15 4 * * *"')
    }
  })
})
