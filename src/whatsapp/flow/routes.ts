/**
 * Rota pública do endpoint de dados do Flow — sem Clerk.
 * POST /api/webhooks/whatsapp/flows
 */
import { Hono } from 'hono'
import { systemClock, type Clock } from '../../db/clock'
import type { AdminDb } from '../../db/admin/store'
import type { WorkerBindings } from '../../worker/bindings'
import { createChannelLogger } from '../../ops/log'
import { handleFlowDataRequest, createFlowSessionStore } from './endpoint'
import { getFlowToken } from './tokens'
import { isWhatsappFlowConfigured } from './config'
import type { FlowCatalogService, FlowSlotOption, FlowBookingSnapshot } from './screens'

type AppEnv = { Bindings: WorkerBindings }

export type WhatsappFlowRouteOptions = {
  syncAdminDbFactory?: (env: WorkerBindings | undefined) => AdminDb | null
  clockFactory?: () => Clock
  /**
   * Lookup de catálogo/agenda no DO da clínica do token.
   * Em testes: stub. Em produção: stub CLINIC → harness/método Flow.
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
  }>
}

const defaultLog = createChannelLogger('whatsapp_flow')
const sessions = createFlowSessionStore()

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
}> {
  const stub = env.CLINIC.get(env.CLINIC.idFromName(input.token.tenantId))
  if (typeof stub.flowDataExchange !== 'function') {
    return { catalog: [], slots: [], frame: input.frame }
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
  }
  return result
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
      tokenLookup: (token) => {
        if (!adminDb) return null
        try {
          return getFlowToken(adminDb, token)
        } catch {
          return null
        }
      },
      dataLookup,
    })

    defaultLog({
      level: result.status >= 400 ? 'warn' : 'info',
      event: 'whatsapp_flow.endpoint',
      detail: { status: result.status },
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
