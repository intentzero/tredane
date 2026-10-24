import { Hono } from 'hono'
import type { ClinicDurableObject } from './clinic-do'

export type WorkerBindings = {
  DB: D1Database
  CLINIC: DurableObjectNamespace<ClinicDurableObject>
  ATTACHMENTS: R2Bucket
  INBOUND_EVENTS: Queue
  ENVIRONMENT: string
}

export const app = new Hono<{ Bindings: WorkerBindings }>()

// Endpoint técnico público: jamais devolver detalhes de tenant, segredos ou dados pessoais.
app.get('/api/health', (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json({
    status: 'ok',
    service: 'tredane',
    phase: 'f0',
    environment: c.env?.ENVIRONMENT ?? 'development',
  })
})

/**
 * Harness F0: prova roteamento ao DO da clínica. Não é API de produto.
 * Autorização real chega na F1 (#21); aqui só exercita o binding CLINIC.
 */
app.get('/api/f0/clinic/:tenantId/ping', async (c) => {
  const tenantId = c.req.param('tenantId')
  if (!tenantId.startsWith('clinic-demo-')) {
    return c.json({ error: 'synthetic_tenants_only' }, 400)
  }
  const id = c.env.CLINIC.idFromName(tenantId)
  const stub = c.env.CLINIC.get(id)
  const result = await stub.ping(tenantId)
  return c.json(result)
})

app.get('/api/f0/clinic/:tenantId/ws', async (c) => {
  const tenantId = c.req.param('tenantId')
  if (!tenantId.startsWith('clinic-demo-')) {
    return c.json({ error: 'synthetic_tenants_only' }, 400)
  }
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ error: 'websocket_upgrade_required' }, 426)
  }
  const id = c.env.CLINIC.idFromName(tenantId)
  const stub = c.env.CLINIC.get(id)
  return stub.fetch(c.req.raw)
})

app.notFound((c) => c.json({ error: 'not_found' }, 404))
