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
import type { ClientWebBookResult, ClientWebCatalog, ClientWebSlotsResult, WebBookingInput } from './booking'
import type { RescheduleSlotsResult, WebCancelResult } from './manage'
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
  /** DEC-218: serviço e profissional (pré-escolha ao remarcar). */
  serviceId: string
  professionalId: string
  professionalName: string
  /** Sinal pago: a cliente não cancela sozinha (DEC-198). */
  hasPaidSignal: boolean
  /** Variantes da visita (snapshot); vazio sem zonas. */
  zoneNames: string[]
  /** Combo aplicado na visita, se houver. */
  comboName: string | null
  /** Preço cotado (combo / soma zonas / linha do serviço). */
  priceCents: number | null
}

export type ClientWebState = {
  clinicName: string
  firstName: string | null
  timezone: string
  /** DEC-211: «Como chegar» (link do Google Business). */
  locationUrl?: string | null
  appointments: ClientWebAppointment[]
  sessionExpiresAt: number
}

export type ClientWebRouteOptions = {
  dbFactory?: (env: WorkerBindings) => D1Database
  clockFactory?: () => Clock
  /** Testes: substitui a leitura do D1 (nome da clínica) e do Clinic DO. */
  stateLookup?: (env: WorkerBindings, session: ClientWebSession) => Promise<Omit<ClientWebState, 'sessionExpiresAt'> | null>
  /** Testes: substituem as chamadas ao Clinic DO. */
  catalogLookup?: (env: WorkerBindings, session: ClientWebSession) => Promise<ClientWebCatalog | null>
  slotsLookup?: (
    env: WorkerBindings,
    session: ClientWebSession,
    input: {
      serviceId: string
      variantIds: string[]
      from: string
      to: string
      daysOnly?: boolean
      professionalId?: string | null
    },
  ) => Promise<ClientWebSlotsResult | null>
  bookLookup?: (env: WorkerBindings, session: ClientWebSession, input: WebBookingInput) => Promise<ClientWebBookResult | null>
  rescheduleSlotsLookup?: (
    env: WorkerBindings,
    session: ClientWebSession,
    input: {
      appointmentId: string
      from: string
      to: string
      daysOnly?: boolean
      professionalId?: string | null
    },
  ) => Promise<RescheduleSlotsResult | null>
  rescheduleLookup?: (
    env: WorkerBindings,
    session: ClientWebSession,
    input: { appointmentId: string; slotId: string; professionalId?: string | null },
  ) => Promise<ClientWebBookResult | null>
  cancelLookup?: (env: WorkerBindings, session: ClientWebSession, input: { appointmentId: string }) => Promise<WebCancelResult | null>
  askTeamLookup?: (env: WorkerBindings, session: ClientWebSession) => Promise<{ status: 'asked' | 'after_hours' } | null>
}

const MAX_ID = 120
const SLOT_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function str(v: unknown, max = MAX_ID): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null
}

function strList(v: unknown): string[] | null {
  if (v == null) return []
  if (!Array.isArray(v) || v.length > 20) return null
  const out: string[] = []
  for (const x of v) {
    const s = str(x)
    if (!s) return null
    out.push(s)
  }
  return out
}

function clinicStub(env: WorkerBindings, session: ClientWebSession) {
  return env.CLINIC.get(env.CLINIC.idFromName(clinicDurableObjectName(session.tenantId)))
}

const log = createChannelLogger('client_web')

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
    // Página pessoal, sempre presente (DEC-202, revisão 18/11/2026): nunca em cache, sem referrer, fora dos motores de busca, sem moldura.
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
    return c.json({
      ok: true,
      purpose: result.purpose,
      appointmentId: result.appointmentId,
      serviceId: result.serviceId,
      audienceLine: result.audienceLine,
      variantIds: result.variantIds,
      preferredDate: result.preferredDate,
      dayPart: result.dayPart,
      expiresAt: result.expiresAt,
    })
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

  /** Resolve a sessão do cookie, com o mesmo limite por sessão. Devolve a resposta de erro, se for o caso. */
  async function requireSession(
    c: Context<AppEnv>,
    kind: string,
    limit: number,
  ): Promise<{ session: ClientWebSession } | { response: Response }> {
    const sessionToken = getCookie(c, CLIENT_WEB_COOKIE) ?? ''
    const db = dbOf(c.env)
    const ip = c.req.header('cf-connecting-ip') ?? 'desconhecido'
    const limited = await hitRateLimit(db, clock(), {
      bucket: await rateBucket(`${kind}:${sessionToken ? 'sessao' : 'ip'}`, sessionToken || ip),
      limit,
    })
    if (!limited.allowed) {
      c.header('Retry-After', String(limited.retryAfterSec))
      return { response: c.json({ error: 'rate_limited' }, 429) }
    }
    const session = await getClientWebSession(db, clock(), sessionToken)
    if (!session) return { response: c.json({ error: 'session_required' }, 401) }
    // Clínica suspensa ou em exclusão não serve a página (ADR-0018 §7a).
    if (!opts.stateLookup && !(await loadActiveTenantName(db, session.tenantId))) {
      return { response: c.json({ error: 'session_required' }, 401) }
    }
    return { session }
  }

  app.get('/api/c/catalog', async (c) => {
    const got = await requireSession(c, 'catalog', CLIENT_WEB_STATE_LIMIT)
    if ('response' in got) return got.response
    const catalog = opts.catalogLookup
      ? await opts.catalogLookup(c.env, got.session)
      : await clinicStub(c.env, got.session).clientWebCatalog({ tenantId: got.session.tenantId })
    return catalog ? c.json(catalog) : c.json({ error: 'session_required' }, 401)
  })

  app.post('/api/c/availability', async (c) => {
    const got = await requireSession(c, 'avail', 120)
    if ('response' in got) return got.response
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const from = typeof body.from === 'string' && DATE_RE.test(body.from) ? body.from : null
    const to = typeof body.to === 'string' && DATE_RE.test(body.to) ? body.to : null
    // Remarcar: pede as horas de uma marcação (serviço e zonas vêm dela).
    const appointmentId = body.appointmentId === undefined ? null : str(body.appointmentId)
    const professionalId =
      body.professionalId === undefined || body.professionalId === null
        ? null
        : str(body.professionalId)
    if (body.professionalId !== undefined && body.professionalId !== null && !professionalId) {
      return c.json({ error: 'invalid_request' }, 400)
    }
    if (body.appointmentId !== undefined) {
      if (!appointmentId || !from || !to) return c.json({ error: 'invalid_request' }, 400)
      const rinput = {
        appointmentId,
        from,
        to,
        ...(body.daysOnly === true ? { daysOnly: true } : {}),
        ...(professionalId ? { professionalId } : {}),
      }
      const rres = opts.rescheduleSlotsLookup
        ? await opts.rescheduleSlotsLookup(c.env, got.session, rinput)
        : await clinicStub(c.env, got.session).clientWebRescheduleSlots({
            tenantId: got.session.tenantId,
            contactId: got.session.contactId,
            conversationId: got.session.conversationId,
            ...rinput,
          })
      if (!rres) return c.json({ error: 'session_required' }, 401)
      if (!rres.ok) return c.json({ error: rres.error }, rres.error === 'appointment_not_found' ? 404 : 422)
      return c.json({ slots: rres.slots, from: rres.from, to: rres.to, emptyDays: rres.emptyDays })
    }
    const serviceId = str(body.serviceId)
    const variantIds = strList(body.variantIds)
    if (!serviceId || !variantIds || !from || !to) return c.json({ error: 'invalid_request' }, 400)
    const input = {
      serviceId,
      variantIds,
      from,
      to,
      ...(body.daysOnly === true ? { daysOnly: true } : {}),
      ...(professionalId ? { professionalId } : {}),
    }
    const result = opts.slotsLookup
      ? await opts.slotsLookup(c.env, got.session, input)
      : await clinicStub(c.env, got.session).clientWebSlots({
          tenantId: got.session.tenantId,
          contactId: got.session.contactId,
          conversationId: got.session.conversationId,
          ...input,
        })
    if (!result) return c.json({ error: 'session_required' }, 401)
    if (!result.ok) return c.json({ error: result.error }, 422)
    return c.json({ slots: result.slots, from: result.from, to: result.to, emptyDays: result.emptyDays })
  })

  app.post('/api/c/book', async (c) => {
    const got = await requireSession(c, 'book', 30)
    if ('response' in got) return got.response
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const serviceId = str(body.serviceId)
    const variantIds = strList(body.variantIds)
    const slotId = typeof body.slotId === 'string' && SLOT_ID_RE.test(body.slotId) ? body.slotId : null
    const line = body.line === 'feminino' || body.line === 'masculino' ? body.line : body.line == null ? null : undefined
    const professionalId =
      body.professionalId === undefined || body.professionalId === null
        ? null
        : str(body.professionalId)
    if (body.professionalId !== undefined && body.professionalId !== null && !professionalId) {
      return c.json({ error: 'invalid_request' }, 400)
    }
    if (!serviceId || !variantIds || !slotId || line === undefined) return c.json({ error: 'invalid_request' }, 400)
    const input: WebBookingInput = {
      serviceId,
      variantIds,
      line,
      slotId,
      professionalId,
    }
    const result = opts.bookLookup
      ? await opts.bookLookup(c.env, got.session, input)
      : await clinicStub(c.env, got.session).clientWebBook({
          tenantId: got.session.tenantId,
          contactId: got.session.contactId,
          conversationId: got.session.conversationId,
          ...input,
        })
    if (!result) return c.json({ error: 'session_required' }, 401)
    log({ level: 'info', event: 'client_web.book', detail: { status: result.status } })
    // 200 mesmo quando a hora já não está livre: é um resultado esperado, não um erro de pedido.
    return c.json(result)
  })

  app.post('/api/c/reschedule', async (c) => {
    const got = await requireSession(c, 'book', 30)
    if ('response' in got) return got.response
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const appointmentId = str(body.appointmentId)
    const slotId = typeof body.slotId === 'string' && SLOT_ID_RE.test(body.slotId) ? body.slotId : null
    const professionalId =
      body.professionalId === undefined || body.professionalId === null
        ? null
        : str(body.professionalId)
    if (body.professionalId !== undefined && body.professionalId !== null && !professionalId) {
      return c.json({ error: 'invalid_request' }, 400)
    }
    if (!appointmentId || !slotId) return c.json({ error: 'invalid_request' }, 400)
    const input = { appointmentId, slotId, professionalId }
    const result = opts.rescheduleLookup
      ? await opts.rescheduleLookup(c.env, got.session, input)
      : await clinicStub(c.env, got.session).clientWebReschedule({
          tenantId: got.session.tenantId,
          contactId: got.session.contactId,
          conversationId: got.session.conversationId,
          ...input,
        })
    if (!result) return c.json({ error: 'session_required' }, 401)
    log({ level: 'info', event: 'client_web.reschedule', detail: { status: result.status } })
    return c.json(result)
  })

  app.post('/api/c/cancel', async (c) => {
    const got = await requireSession(c, 'book', 30)
    if ('response' in got) return got.response
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const appointmentId = str(body.appointmentId)
    if (!appointmentId) return c.json({ error: 'invalid_request' }, 400)
    const input = { appointmentId }
    const result = opts.cancelLookup
      ? await opts.cancelLookup(c.env, got.session, input)
      : await clinicStub(c.env, got.session).clientWebCancel({
          tenantId: got.session.tenantId,
          contactId: got.session.contactId,
          conversationId: got.session.conversationId,
          ...input,
        })
    if (!result) return c.json({ error: 'session_required' }, 401)
    log({ level: 'info', event: 'client_web.cancel', detail: { status: result.status } })
    return c.json(result)
  })

  app.post('/api/c/ask-team', async (c) => {
    const got = await requireSession(c, 'book', 30)
    if ('response' in got) return got.response
    const result = opts.askTeamLookup
      ? await opts.askTeamLookup(c.env, got.session)
      : await clinicStub(c.env, got.session).clientWebAskTeam({
          tenantId: got.session.tenantId,
          contactId: got.session.contactId,
          conversationId: got.session.conversationId,
        })
    if (!result) return c.json({ error: 'session_required' }, 401)
    log({ level: 'info', event: 'client_web.ask_team', detail: { status: result.status } })
    return c.json(result)
  })

  return app
}
