/**
 * Rotas públicas da página web da cliente — sem Clerk (DEC-196 a DEC-199, ADR-0018).
 *
 *   POST /api/c/exchange  troca o token do link por uma sessão curta (cookie)
 *   GET  /api/c/state     nome da clínica e marcações futuras do contacto da sessão
 *
 * `GET /c/:token` é a casca da SPA servida como asset: abrir o link não gasta o token.
 * A clínica e o contacto saem SÓ da sessão; o pedido nunca traz `tenant_id` nem `contact_id`.
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { systemClock, type Clock } from '../db/clock'
import { clinicDurableObjectName } from '../clinic/demo/do-name'
import { createChannelLogger } from '../ops/log'
import type { WorkerBindings } from '../worker/bindings'
import {
  CLIENT_WEB_EXCHANGE_LIMIT,
  CLIENT_WEB_STATE_LIMIT,
  hitRateLimit,
  pruneRateLimits,
  rateBucket,
} from './rate-limit'
import {
  exchangeClientWebLink,
  getClientWebSession,
  CLIENT_WEB_SESSION_TTL_MS,
  type ClientWebSession,
} from './links'

type AppEnv = { Bindings: WorkerBindings }

export const CLIENT_WEB_COOKIE = 'tredane_cw'

export type ClientWebAppointment = {
  id: string
  serviceName: string
  startsAt: number
  endsAt: number
}

export type ClientWebState = {
  clinicName: string
  firstName: string | null
  timezone: string
  appointments: ClientWebAppointment[]
  sessionExpiresAt: number
}

export type ClientWebRouteOptions = {
  dbFactory?: (env: WorkerBindings) => D1Database
  clockFactory?: () => Clock
  /** Testes: substitui a leitura do D1 (nome da clínica) e do Clinic DO. */
  stateLookup?: (env: WorkerBindings, session: ClientWebSession) => Promise<Omit<ClientWebState, 'sessionExpiresAt'> | null>
}

const log = createChannelLogger('client_web')

/** Interruptor global (DEC-199). O interruptor por clínica entra com a configuração da owner. */
export function isClientWebEnabled(env: WorkerBindings | undefined): boolean {
  return env?.CLIENT_WEB_ENABLED === 'true'
}

/**
 * Nome da clínica, só se estiver ativa. Clínica suspensa ou em exclusão não serve a página:
 * a sessão deixa de valer na prática (ADR-0018 §7a), sem depender de revogar uma a uma.
 */
export async function loadActiveTenantName(db: D1Database, tenantId: string): Promise<string | null> {
  const tenant = await db
    .prepare('SELECT name, status FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first<{ name: string; status: string | null }>()
  if (!tenant || (tenant.status ?? 'active') !== 'active') return null
  return tenant.name
}

async function defaultStateLookup(
  env: WorkerBindings,
  db: D1Database,
  session: ClientWebSession,
): Promise<Omit<ClientWebState, 'sessionExpiresAt'> | null> {
  const tenantName = await loadActiveTenantName(db, session.tenantId)
  if (!tenantName) return null
  const stub = env.CLINIC.get(env.CLINIC.idFromName(clinicDurableObjectName(session.tenantId)))
  const data = await stub.clientWebState({
    tenantId: session.tenantId,
    contactId: session.contactId,
    conversationId: session.conversationId,
  })
  if (!data) return null
  return { clinicName: tenantName, ...data }
}

function sameOrigin(c: Context<AppEnv>): boolean {
  const origin = c.req.header('Origin')
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(c.req.url).origin
  } catch {
    return false
  }
}

export function createClientWebRoutes(opts: ClientWebRouteOptions = {}) {
  const app = new Hono<AppEnv>()
  const clock = () => opts.clockFactory?.() ?? systemClock
  const dbOf = (env: WorkerBindings) => opts.dbFactory?.(env) ?? env.DB

  app.use('/api/c/*', async (c, next) => {
    if (!isClientWebEnabled(c.env)) return c.json({ error: 'not_found' }, 404)
    // Página pessoal: nunca em cache, sem referrer, fora dos motores de busca, sem moldura.
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Robots-Tag', 'noindex')
    c.header('X-Frame-Options', 'DENY')
    c.header('Content-Security-Policy', "frame-ancestors 'none'")
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !sameOrigin(c)) {
      return c.json({ error: 'forbidden_origin' }, 403)
    }
    await next()
  })

  app.post('/api/c/exchange', async (c) => {
    const db = dbOf(c.env)
    const ip = c.req.header('cf-connecting-ip') ?? 'desconhecido'
    const limited = await hitRateLimit(db, clock(), {
      bucket: await rateBucket('exchange:ip', ip),
      limit: CLIENT_WEB_EXCHANGE_LIMIT,
    })
    if (!limited.allowed) {
      c.header('Retry-After', String(limited.retryAfterSec))
      log({ level: 'warn', event: 'client_web.rate_limited', detail: { route: 'exchange' } })
      return c.json({ error: 'rate_limited' }, 429)
    }
    // Limpeza oportunista (1 em 50 trocas).
    if (Math.random() < 0.02) void pruneRateLimits(db, clock())
    let token = ''
    try {
      const body = (await c.req.json()) as { token?: unknown }
      if (typeof body.token === 'string') token = body.token
    } catch {
      /* corpo inválido: tratado como link indisponível */
    }
    const result = await exchangeClientWebLink(db, clock(), token)
    if (!result) {
      // Mesma resposta para inexistente, usado, expirado ou substituído (sem enumeração).
      log({ level: 'info', event: 'client_web.exchange_refused', detail: {} })
      return c.json({ error: 'link_unavailable' }, 410)
    }
    setCookie(c, CLIENT_WEB_COOKIE, result.sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/api/c',
      maxAge: Math.floor(CLIENT_WEB_SESSION_TTL_MS / 1000),
    })
    log({ level: 'info', event: 'client_web.exchange_ok', detail: { purpose: result.purpose } })
    return c.json({ ok: true, purpose: result.purpose, expiresAt: result.expiresAt })
  })

  app.get('/api/c/state', async (c) => {
    const sessionToken = getCookie(c, CLIENT_WEB_COOKIE) ?? ''
    const db = dbOf(c.env)
    const ip = c.req.header('cf-connecting-ip') ?? 'desconhecido'
    const limited = await hitRateLimit(db, clock(), {
      bucket: await rateBucket(sessionToken ? 'state:sessao' : 'state:ip', sessionToken || ip),
      limit: CLIENT_WEB_STATE_LIMIT,
    })
    if (!limited.allowed) {
      c.header('Retry-After', String(limited.retryAfterSec))
      log({ level: 'warn', event: 'client_web.rate_limited', detail: { route: 'state' } })
      return c.json({ error: 'rate_limited' }, 429)
    }
    const session = await getClientWebSession(db, clock(), sessionToken)
    if (!session) {
      deleteCookie(c, CLIENT_WEB_COOKIE, { path: '/api/c' })
      return c.json({ error: 'session_required' }, 401)
    }
    const state = opts.stateLookup
      ? await opts.stateLookup(c.env, session)
      : await defaultStateLookup(c.env, db, session)
    if (!state) return c.json({ error: 'session_required' }, 401)
    const body: ClientWebState = { ...state, sessionExpiresAt: session.expiresAt }
    return c.json(body)
  })

  return app
}
