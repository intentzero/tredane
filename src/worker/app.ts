import { Hono } from 'hono'
import { workerCaller } from '../clinic'
import {
  buildAuthServices,
  createAuthRoutes,
  createAuthServicesMiddleware,
  type AuthDepsFactory,
  type AuthEnv,
  type AuthServices,
} from '../auth'
import type { ClinicDurableObject } from './clinic-do'

export type WorkerBindings = AuthEnv['Bindings'] & {
  CLINIC: DurableObjectNamespace<ClinicDurableObject>
  ATTACHMENTS: R2Bucket
  INBOUND_EVENTS: Queue
}

type AppEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type CreateAppOptions = {
  /** Injeta serviços de auth (testes). Por omissão usa buildAuthServices(env). */
  authServicesFactory?: (env: WorkerBindings) => AuthServices
}

export function createApp(opts: CreateAppOptions = {}) {
  const app = new Hono<AppEnv>()
  const factory: AuthDepsFactory = (env) => {
    if (opts.authServicesFactory) {
      return opts.authServicesFactory(env as WorkerBindings)
    }
    return buildAuthServices(env)
  }

  app.use('/api/me/*', createAuthServicesMiddleware(factory))
  app.use('/api/me', createAuthServicesMiddleware(factory))
  app.use('/api/tenants/*', createAuthServicesMiddleware(factory))
  app.use('/api/platform/*', createAuthServicesMiddleware(factory))

  app.route('/', createAuthRoutes())

  function clinicStub(env: WorkerBindings, tenantId: string) {
    const id = env.CLINIC.idFromName(tenantId)
    return env.CLINIC.get(id)
  }

  // Endpoint técnico público: jamais devolver detalhes de tenant, segredos ou dados pessoais.
  app.get('/api/health', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({
      status: 'ok',
      service: 'tredane',
      phase: 'f1',
      environment: c.env?.ENVIRONMENT ?? 'development',
    })
  })

  /**
   * Harness: prova roteamento ao DO da clínica. Não é API de produto.
   * Autorização Clerk de produto está em /api/tenants/*; aqui só tenants sintéticos.
   */
  app.get('/api/f0/clinic/:tenantId/ping', async (c) => {
    const tenantId = c.req.param('tenantId')
    if (!tenantId.startsWith('clinic-demo-')) {
      return c.json({ error: 'synthetic_tenants_only' }, 400)
    }
    const result = await clinicStub(c.env, tenantId).ping(tenantId)
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
    return clinicStub(c.env, tenantId).fetch(c.req.raw)
  })

  /**
   * Harness F1 (#20): ingestão + outbox no DO. Sem UI de painel.
   */
  app.post('/api/f1/clinic/:tenantId/ingest', async (c) => {
    const tenantId = c.req.param('tenantId')
    if (!tenantId.startsWith('clinic-demo-')) {
      return c.json({ error: 'synthetic_tenants_only' }, 400)
    }
    const body = await c.req.json<{
      providerEventKey: string
      waId: string
      displayName?: string
      body: string
      drain?: boolean
    }>()
    if (!body?.providerEventKey || !body?.waId || typeof body.body !== 'string') {
      return c.json({ error: 'invalid_body' }, 400)
    }
    try {
      const result = await clinicStub(c.env, tenantId).ingestMessage(
        workerCaller(tenantId, 'harness'),
        {
          providerEventKey: body.providerEventKey,
          waId: body.waId,
          displayName: body.displayName,
          body: body.body,
        },
        { drain: body.drain },
      )
      return c.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ingest_failed'
      const status = message.includes('Tenant') || message.includes('tenant') ? 403 : 400
      return c.json({ error: message }, status)
    }
  })

  app.post('/api/f1/clinic/:tenantId/drain', async (c) => {
    const tenantId = c.req.param('tenantId')
    if (!tenantId.startsWith('clinic-demo-')) {
      return c.json({ error: 'synthetic_tenants_only' }, 400)
    }
    try {
      const result = await clinicStub(c.env, tenantId).drainOutbox(workerCaller(tenantId))
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'drain_failed' }, 400)
    }
  })

  app.get('/api/f1/clinic/:tenantId/status', async (c) => {
    const tenantId = c.req.param('tenantId')
    if (!tenantId.startsWith('clinic-demo-')) {
      return c.json({ error: 'synthetic_tenants_only' }, 400)
    }
    try {
      const result = await clinicStub(c.env, tenantId).getStatus(workerCaller(tenantId))
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'status_failed' }, 400)
    }
  })

  /** Prova de tenant forjado: RPC com caller.tenantId ≠ rota → recusa no DO. */
  app.post('/api/f1/clinic/:tenantId/ingest-forged', async (c) => {
    const tenantId = c.req.param('tenantId')
    if (!tenantId.startsWith('clinic-demo-')) {
      return c.json({ error: 'synthetic_tenants_only' }, 400)
    }
    const forged = c.req.query('forged') ?? 'clinic-demo-b'
    try {
      await clinicStub(c.env, tenantId).ingestMessage(
        workerCaller(forged, 'attacker'),
        {
          providerEventKey: `forged:${Date.now()}`,
          waId: '5511000000099',
          body: 'should-fail',
        },
        { drain: false },
      )
      return c.json({ error: 'expected_rejection' }, 500)
    } catch (err) {
      return c.json(
        {
          rejected: true,
          error: err instanceof Error ? err.message : 'rejected',
        },
        403,
      )
    }
  })

  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  return app
}

/** App default do Worker — auth via buildAuthServices (Clerk ou synthetic em development). */
export const app = createApp()
