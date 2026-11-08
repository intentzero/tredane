/**
 * Rota pública do endpoint de dados do Flow — sem Clerk.
 * POST /api/webhooks/whatsapp/flows
 *
 * Produção: tokens + sessão via `env.DB` (createD1FlowOps), como o webhook.
 * Testes: syncAdminDbFactory / dataLookupFactory injectáveis.
 */
import { Hono } from 'hono'
import { systemClock, type Clock } from '../../db/clock'
import type { AdminDb } from '../../db/admin/store'
import type { WorkerBindings } from '../../worker/bindings'
import { createChannelLogger } from '../../ops/log'
import {
  handleFlowDataRequest,
  createTokenBackedSessionStore,
  type FlowSessionStore,
  type FlowTokenLookup,
} from './endpoint'
import { createD1FlowOps } from './flow-d1'
import {
  getFlowToken,
  saveFlowTokenSession,
} from './tokens'
import { isWhatsappFlowConfigured } from './config'
import type { FlowCatalogService, FlowSlotOption, FlowBookingSnapshot } from './screens'

type AppEnv = { Bindings: WorkerBindings }

export type WhatsappFlowRouteOptions = {
  syncAdminDbFactory?: (env: WorkerBindings | undefined) => AdminDb | null
  clockFactory?: () => Clock
  /**
   * Lookup de catálogo/agenda no DO da clínica do token.
   * Em testes: stub. Em produção: stub CLINIC → flowDataExchange.
   */
  dataLookupFactory?: (env: WorkerBindings) => (input: {
    token: {
      tenantId: string
      conversationId: string
      catalogVersion: string
    }
    frame: FlowBookingSnapshot
  }) => Promise<{
    catalog: FlowCatalogService[]
    slots: FlowSlotOption[]
    frame: FlowBookingSnapshot
    catalogMismatch?: boolean
    clearedFields?: Array<'serviceId' | 'line' | 'variantIds' | 'slotKey'>
    visitTotalLine?: string | null
  }>
  /** Override de tokenLookup (testes). */
  tokenLookupFactory?: (env: WorkerBindings, clock: Clock) => FlowTokenLookup
  /** Override de session store (testes — ex. perda do Map). */
  sessionStoreFactory?: (env: WorkerBindings, clock: Clock) => FlowSessionStore
}

const defaultLog = createChannelLogger('whatsapp_flow')

async function defaultDataLookup(
  env: WorkerBindings,
  input: {
    token: { tenantId: string; conversationId: string; catalogVersion: string }
    frame: FlowBookingSnapshot
  },
): Promise<{
  catalog: FlowCatalogService[]
  slots: FlowSlotOption[]
  frame: FlowBookingSnapshot
  catalogMismatch?: boolean
    clearedFields?: Array<'serviceId' | 'line' | 'variantIds' | 'slotKey'>
    visitTotalLine?: string | null
  }> {
  const stub = env.CLINIC.get(env.CLINIC.idFromName(input.token.tenantId))
  if (typeof stub.flowDataExchange !== 'function') {
    return { catalog: [], slots: [], frame: input.frame, catalogMismatch: false, clearedFields: [] }
  }
  const result = (await stub.flowDataExchange({
    tenantId: input.token.tenantId,
    conversationId: input.token.conversationId,
    catalogVersion: input.token.catalogVersion,
    frame: input.frame,
  })) as {
    catalog: FlowCatalogService[]
    slots: FlowSlotOption[]
    frame: FlowBookingSnapshot
    catalogMismatch?: boolean
    clearedFields?: Array<'serviceId' | 'line' | 'variantIds' | 'slotKey'>
    visitTotalLine?: string | null
  }
  return result
}

/**
 * T3: na primeira gravação que preenche `opened_at`, notifica o Clinic DO
 * para emitir `booking_session.flow` (mesmo sessionId T1/T2 da conversa).
 */
async function notifyFlowOpened(
  env: WorkerBindings,
  token: string,
  row: { tenantId: string; conversationId: string; openedAt: number | null },
): Promise<void> {
  if (row.openedAt != null) return
  try {
    const stub = env.CLINIC.get(env.CLINIC.idFromName(row.tenantId))
    if (typeof stub.recordFlowOpened !== 'function') return
    await stub.recordFlowOpened({
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      flowToken: token,
    })
  } catch {
    // Telemetria não bloqueia o endpoint Flow.
  }
}

function defaultTokenAndSession(
  env: WorkerBindings,
  clock: Clock,
  syncAdminDb: AdminDb | null,
): { tokenLookup: FlowTokenLookup; sessions: FlowSessionStore } {
  if (syncAdminDb) {
    return {
      tokenLookup: async (token) => {
        try {
          return getFlowToken(syncAdminDb, token)
        } catch {
          return null
        }
      },
      sessions: createTokenBackedSessionStore({
        getToken: async (token) => {
          try {
            return getFlowToken(syncAdminDb, token)
          } catch {
            return null
          }
        },
        saveSession: async (token, session) => {
          const before = getFlowToken(syncAdminDb, token)
          saveFlowTokenSession(syncAdminDb, token, session, clock.nowMs())
          if (before) {
            await notifyFlowOpened(env, token, before)
          }
        },
      }),
    }
  }
  // Produção / Worker: D1 async (Finding 2).
  const ops = createD1FlowOps(env.DB, clock)
  return {
    tokenLookup: (token) => ops.getToken(token),
    sessions: createTokenBackedSessionStore({
      getToken: (token) => ops.getToken(token),
      saveSession: async (token, session) => {
        const before = await ops.getToken(token)
        await ops.saveSession(token, session)
        if (before) {
          await notifyFlowOpened(env, token, before)
        }
      },
    }),
  }
}

export function createWhatsappFlowRoutes(opts: WhatsappFlowRouteOptions = {}) {
  const app = new Hono<AppEnv>()

  app.post('/api/webhooks/whatsapp/flows', async (c) => {
    const env = c.env
    if (!isWhatsappFlowConfigured(env)) {
      return c.json({ error: 'flow_endpoint_unconfigured' }, 503)
    }
    const rawBody = await c.req.text()
    const signatureHeader = c.req.header('X-Hub-Signature-256')
    const clock = opts.clockFactory?.() ?? systemClock
    const adminDb = opts.syncAdminDbFactory?.(env) ?? null

    const defaults = defaultTokenAndSession(env, clock, adminDb)
    const tokenLookup =
      opts.tokenLookupFactory?.(env, clock) ?? defaults.tokenLookup
    const sessions =
      opts.sessionStoreFactory?.(env, clock) ?? defaults.sessions

    const dataLookup =
      opts.dataLookupFactory?.(env) ??
      ((input) => defaultDataLookup(env, input))

    const result = await handleFlowDataRequest({
      rawBody,
      signatureHeader,
      env: {
        WHATSAPP_FLOW_PRIVATE_KEY: env.WHATSAPP_FLOW_PRIVATE_KEY,
        META_APP_SECRET: env.META_APP_SECRET,
      },
      clock,
      sessions,
      tokenLookup,
      dataLookup,
    })

    defaultLog({
      level: result.status >= 400 ? 'warn' : 'info',
      event: 'whatsapp_flow.endpoint',
      detail: {
        status: result.status,
        ...('logDetail' in result && result.logDetail ? result.logDetail : {}),
      },
    })

    if (result.status === 200 && 'contentType' in result && result.contentType === 'text/plain') {
      return new Response(result.body as string, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  return app
}
