import { Hono } from 'hono'
import { workerCaller } from '../clinic'
import {
  buildAuthServices,
  createAuthRoutes,
  createAuthServicesMiddleware,
  resolveAuthMode,
  type AuthDepsFactory,
  type AuthEnv,
  type AuthServices,
} from '../auth'
import {
  createRealtimeRoutes,
  type ClinicAccessInvalidator,
  type RealtimeRouteOptions,
} from '../realtime'
import {
  createPlatformRoutes,
  type PlatformRouteOptions,
} from '../platform'
import {
  createTeamRoutes,
  type TeamRouteOptions,
} from '../team'
import {
  createSupportRoutes,
  type SupportRouteOptions,
} from '../support'
import {
  createClinicConfigRoutes,
  type ClinicConfigRouteOptions,
} from '../clinic-config'
import {
  createInboxRoutes,
  type InboxRouteOptions,
} from '../inbox'
import {
  createPipelineRoutes,
  type PipelineRouteOptions,
} from '../pipeline'
import {
  createWhatsappRoutes,
  createWhatsappWebhookRoutes,
  type WhatsappRouteOptions,
  type WhatsappWebhookRouteOptions,
} from '../whatsapp'
import type { Clock } from '../db/clock'
import type { EmailTransport } from '../email'
import type { AdminDb } from '../db/admin/store'
import type { ClinicEventPublisher } from '../realtime'
import type { WorkerBindings } from './bindings'
import type { ClinicConfigGateway } from '../clinic-config'
import type { InboxGateway } from '../inbox'
import type { PipelineGateway } from '../pipeline'

export type { WorkerBindings } from './bindings'

type AppEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type CreateAppOptions = {
  /** Injeta serviços de auth (testes). Por omissão usa buildAuthServices(env). */
  authServicesFactory?: (env: WorkerBindings) => AuthServices
  /** Invalidator D1→DO (testes de falha de notificação). */
  invalidatorFactory?: (env: WorkerBindings) => ClinicAccessInvalidator
  /** AdminDb sync para revoke / equipe em testes unitários. */
  syncAdminDbFactory?: (env: WorkerBindings) => AdminDb | null
  /** Relógio injetável (limites temporais de convite). */
  clockFactory?: () => Clock
  /** Transporte de e-mail (simulado por omissão em testes). */
  emailFactory?: (env: WorkerBindings) => EmailTransport
  appBaseUrlFactory?: (env: WorkerBindings) => string
  /** Fan-out de eventos de suporte (#26). */
  eventPublisherFactory?: (env: WorkerBindings) => ClinicEventPublisher
  /** Gateway de config da clínica (#28) — DO em produção; memória nos testes. */
  clinicConfigGatewayFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => ClinicConfigGateway | Promise<ClinicConfigGateway>
  /** Gateway da caixa de entrada (#29). */
  inboxGatewayFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => InboxGateway | Promise<InboxGateway>
  /** Gateway do Acompanhamento (#30). */
  pipelineGatewayFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => PipelineGateway | Promise<PipelineGateway>
  /** Serviço WhatsApp (#31) — testes injectam AdminDb + sync em memória. */
  whatsappServiceFactory?: WhatsappRouteOptions['serviceFactory']
  /** Webhooks Meta (#32) — AdminDb sync + fila injectável nos testes. */
  whatsappWebhook?: WhatsappWebhookRouteOptions
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
  app.use('/api/support/*', createAuthServicesMiddleware(factory))
  app.use('/api/support', createAuthServicesMiddleware(factory))
  app.use('/api/invitations/*', createAuthServicesMiddleware(factory))
  app.use('/api/invitations', createAuthServicesMiddleware(factory))

  app.route('/', createAuthRoutes())

  const realtimeOpts: RealtimeRouteOptions = {
    invalidatorFactory: opts.invalidatorFactory,
    syncAdminDbFactory: opts.syncAdminDbFactory,
  }
  app.route('/', createRealtimeRoutes(realtimeOpts))

  const platformOpts: PlatformRouteOptions = {
    invalidatorFactory: opts.invalidatorFactory,
    syncAdminDbFactory: opts.syncAdminDbFactory,
  }
  app.route('/', createPlatformRoutes(platformOpts))

  const teamOpts: TeamRouteOptions = {
    syncAdminDbFactory: opts.syncAdminDbFactory,
    clockFactory: opts.clockFactory,
    emailFactory: opts.emailFactory,
    appBaseUrlFactory: opts.appBaseUrlFactory,
  }
  app.route('/', createTeamRoutes(teamOpts))

  const supportOpts: SupportRouteOptions = {
    syncAdminDbFactory: opts.syncAdminDbFactory,
    clockFactory: opts.clockFactory,
    emailFactory: opts.emailFactory,
    appBaseUrlFactory: opts.appBaseUrlFactory,
    eventPublisherFactory: opts.eventPublisherFactory,
  }
  app.route('/', createSupportRoutes(supportOpts))

  const configOpts: ClinicConfigRouteOptions = {
    gatewayFactory: opts.clinicConfigGatewayFactory,
  }
  app.route('/', createClinicConfigRoutes(configOpts))

  const inboxOpts: InboxRouteOptions = {
    gatewayFactory: opts.inboxGatewayFactory,
    syncAdminDbFactory: opts.syncAdminDbFactory,
  }
  app.route('/', createInboxRoutes(inboxOpts))

  const pipelineOpts: PipelineRouteOptions = {
    gatewayFactory: opts.pipelineGatewayFactory,
  }
  app.route('/', createPipelineRoutes(pipelineOpts))

  const whatsappOpts: WhatsappRouteOptions = {
    syncAdminDbFactory: opts.syncAdminDbFactory,
    clockFactory: opts.clockFactory,
    serviceFactory: opts.whatsappServiceFactory,
  }
  app.route('/', createWhatsappRoutes(whatsappOpts))

  // Webhooks públicos (#32) — sem middleware Clerk.
  const webhookOpts: WhatsappWebhookRouteOptions = {
    syncAdminDbFactory:
      opts.whatsappWebhook?.syncAdminDbFactory ??
      (opts.syncAdminDbFactory
        ? (env) => opts.syncAdminDbFactory!(env as WorkerBindings)
        : undefined),
    clockFactory: opts.whatsappWebhook?.clockFactory ?? opts.clockFactory,
    queueFactory: opts.whatsappWebhook?.queueFactory,
    logFactory: opts.whatsappWebhook?.logFactory,
  }
  app.route('/', createWhatsappWebhookRoutes(webhookOpts))

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
   * Bootstrap do cliente (#22): modo de auth e chave pública Clerk.
   * Sem secret key; publishable key é pública por desenho.
   */
  app.get('/api/auth/client-config', (c) => {
    c.header('Cache-Control', 'no-store')
    const mode = resolveAuthMode({
      ENVIRONMENT: c.env?.ENVIRONMENT,
      AUTH_MODE: c.env?.AUTH_MODE,
      CLERK_SECRET_KEY: c.env?.CLERK_SECRET_KEY,
      CLERK_PUBLISHABLE_KEY: c.env?.CLERK_PUBLISHABLE_KEY,
    })
    return c.json({
      authMode: mode,
      clerkPublishableKey:
        mode === 'clerk' ? (c.env?.CLERK_PUBLISHABLE_KEY ?? null) : null,
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
      fanout?: boolean
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
        { drain: body.drain, fanout: body.fanout },
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

  /** Harness: força authority override no DO (testes de cache positivo / unavailable). */
  app.post('/api/f1/clinic/:tenantId/authority-override', async (c) => {
    const tenantId = c.req.param('tenantId')
    if (!tenantId.startsWith('clinic-demo-')) {
      return c.json({ error: 'synthetic_tenants_only' }, 400)
    }
    const body = await c.req.json<{
      grants?: Record<string, 'owner' | 'attendant' | 'deny' | 'unavailable'>
      clear?: boolean
    }>()
    const stub = clinicStub(c.env, tenantId)
    if (body.clear) {
      await stub.clearAuthorityOverrideForTests()
      return c.json({ ok: true, cleared: true })
    }
    await stub.setAuthorityOverrideForTests(body.grants ?? {})
    return c.json({ ok: true })
  })

  app.post('/api/f1/clinic/:tenantId/revalidate-sockets', async (c) => {
    const tenantId = c.req.param('tenantId')
    if (!tenantId.startsWith('clinic-demo-')) {
      return c.json({ error: 'synthetic_tenants_only' }, 400)
    }
    const result = await clinicStub(c.env, tenantId).revalidateOpenSockets(
      workerCaller(tenantId),
    )
    return c.json(result)
  })

  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  return app
}

/** App default do Worker — auth via buildAuthServices (Clerk ou synthetic em development). */
export const app = createApp()
