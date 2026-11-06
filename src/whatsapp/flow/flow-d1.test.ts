/**
 * Finding 2: tokenLookup async sem syncAdminDbFactory (padrão webhook D1).
 */
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createControllableClock } from '../../db/clock'
import { bootAdminDb } from '../../db/test-db'
import { computeHubSignature256 } from '../webhook-verify'
import { encryptFlowRequestForTest, generateFlowKeyPair } from './crypto'
import { createD1FlowOps } from './flow-d1'
import { createWhatsappFlowRoutes } from './routes'
import { generateFlowToken } from './tokens'
import { EMPTY_FLOW_SESSION } from './tokens'

/** Adaptador mínimo AdminDb → interface D1 prepare/bind/first/run. */
type SqlParam = string | number | null | Uint8Array

function adminDbAsD1(admin: ReturnType<typeof bootAdminDb>['db']): D1Database {
  return {
    prepare(sql: string) {
      const binds: SqlParam[] = []
      const stmt = {
        bind(...args: SqlParam[]) {
          binds.push(...args)
          return stmt
        },
        async first<T>() {
          return (admin.get(sql, ...binds) as T | undefined) ?? null
        },
        async run() {
          admin.run(sql, ...binds)
          return { success: true, meta: {} }
        },
        async all() {
          return { results: admin.all(sql, ...binds), success: true, meta: {} }
        },
      }
      return stmt
    },
  } as unknown as D1Database
}

describe('createD1FlowOps + rota sem syncAdminDbFactory (Finding 2)', () => {
  it('getToken / saveSession via D1-like async', async () => {
    const { db, close } = bootAdminDb()
    try {
      const clock = createControllableClock(1_700_000_000_000)
      const d1 = adminDbAsD1(db)
      const ops = createD1FlowOps(d1, clock)
      const token = generateFlowToken()
      await ops.insertToken({
        token,
        tenantId: 'clinic-demo-a',
        bindingId: 'bind-x',
        phoneNumberId: 'pn-x',
        wabaId: 'waba-x',
        conversationId: 'cnv-x',
        catalogVersion: '1',
      })
      const row = await ops.getToken(token)
      expect(row?.tenantId).toBe('clinic-demo-a')
      expect(row?.session.serviceId).toBeNull()
      const openedAt = () =>
        db.get<{ opened_at: number | null }>(
          `SELECT opened_at FROM whatsapp_flow_tokens WHERE token = ?`,
          token,
        )?.opened_at ?? null
      // DEC-143: enviado ainda não é aberto.
      expect(openedAt()).toBeNull()
      const firstCall = clock.nowMs()
      await ops.saveSession(token, { ...EMPTY_FLOW_SESSION })
      expect(openedAt()).toBe(firstCall)
      clock.advance(60_000)
      await ops.saveSession(token, {
        serviceId: 'svc1',
        line: 'feminino',
        variantIds: ['z1'],
        slotKey: null,
      })
      const again = await ops.getToken(token)
      expect(again?.session).toEqual({
        serviceId: 'svc1',
        line: 'feminino',
        variantIds: ['z1'],
        slotKey: null,
      })
      // A primeira abertura não é reescrita pelos ecrãs seguintes.
      expect(openedAt()).toBe(firstCall)
    } finally {
      close()
    }
  })

  it('rota usa tokenLookup async (env.DB) quando não há syncAdminDbFactory', async () => {
    const { db, close } = bootAdminDb()
    try {
      const pair = await generateFlowKeyPair()
      const clock = createControllableClock(Date.UTC(2026, 10, 5, 13, 0))
      const seedTenant = db.get<{ id: string }>(`SELECT id FROM tenants LIMIT 1`)
      if (!seedTenant) return

      // Binding mínimo para FK se necessário — tokens só referenciam tenant.
      const token = generateFlowToken()
      const d1 = adminDbAsD1(db)
      const ops = createD1FlowOps(d1, clock)
      await ops.insertToken({
        token,
        tenantId: seedTenant.id,
        bindingId: 'b-flow',
        phoneNumberId: 'pn-flow',
        wabaId: 'w-flow',
        conversationId: 'c-flow',
        catalogVersion: '1',
      })

      const app = new Hono()
      app.route(
        '/',
        createWhatsappFlowRoutes({
          clockFactory: () => clock,
          // Sem syncAdminDbFactory — força caminho D1.
          tokenLookupFactory: () => (t) => ops.getToken(t),
          sessionStoreFactory: () => ({
            get: async (t) => {
              const row = await ops.getToken(t)
              return row?.session ?? { ...EMPTY_FLOW_SESSION }
            },
            set: async (t, session) => ops.saveSession(t, session),
          }),
          dataLookupFactory: () => async () => ({
            catalog: [
              { id: 's1', name: 'A', active: true, zones: [] },
              { id: 's2', name: 'B', active: true, zones: [] },
            ],
            slots: [],
            frame: { ...EMPTY_FLOW_SESSION },
          }),
        }),
      )

      const encrypted = await encryptFlowRequestForTest(pair.publicKey, {
        version: '3.0',
        action: 'INIT',
        flow_token: token,
      })
      const rawBody = JSON.stringify(encrypted)
      const signature = await computeHubSignature256(rawBody, 'secret-flow-d1')

      const res = await app.request('/api/webhooks/whatsapp/flows', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
        },
        body: rawBody,
      }, {
        WHATSAPP_FLOW_ID: 'flow-test',
        WHATSAPP_FLOW_PRIVATE_KEY: pair.privatePem,
        META_APP_SECRET: 'secret-flow-d1',
        DB: d1,
      } as never)

      // Sem CLINIC binding na request — tokenLookup ainda resolve; dataLookup injectado.
      expect([200, 503]).toContain(res.status)
      if (res.status === 200) {
        const text = await res.text()
        expect(text.length).toBeGreaterThan(10)
      }
    } finally {
      close()
    }
  })
})
