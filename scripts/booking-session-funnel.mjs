#!/usr/bin/env node
/**
 * T4 / DEC-148: leitura operacional do funil `booking_session` (sem transcript).
 *
 *   node scripts/booking-session-funnel.mjs staging <tenantId> [desde=YYYY-MM-DD] [--from-jsonl path|-]
 *
 * Sem `--from-jsonl`: imprime o pacote operacional (SQL no SQLite do Clinic DO +
 * filtros Workers Logs). Não há D1 remoto para esta projecção — vive no DO.
 *
 * Com `--from-jsonl`: agrega outcomes, funil por `step` / `dropStep`, top friction
 * e `flowUsed` a partir de linhas `console.log` (wrangler tail / export Observability).
 * Aceita `-` para stdin. Sem corpo de mensagem; sem juiz LLM.
 *
 * TREDANE_FUNNEL_DRY_RUN=1 força só o pacote (mesmo com --from-jsonl).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { D1_ENVS } from './d1-env.mjs'

const TENANT_RE = /^[A-Za-z0-9_-]{1,80}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Ordem canónica do funil (session-analytics §4.2). */
export const FUNNEL_STEPS = [
  'hub',
  'audience',
  'service',
  'variant_ask',
  'day_ask',
  'echo',
  'slot_offer',
  'proposal',
  'confirm',
]

const STEP_INDEX = new Map(FUNNEL_STEPS.map((s, i) => [s, i]))

const TELEMETRY_EVENTS = new Set([
  'booking_session.opened',
  'booking_session.ended',
  'booking_session.flow',
  'ai.turn_decided',
])

/**
 * @param {string} tenantId
 * @param {number} sinceMs
 */
export function buildBookingSessionFunnelSql(tenantId, sinceMs) {
  if (!TENANT_RE.test(tenantId)) throw new Error(`tenantId inválido: ${tenantId}`)
  if (!Number.isSafeInteger(sinceMs) || sinceMs < 0) throw new Error('instante inválido')
  const since = sinceMs
  return {
    outcomes: [
      'SELECT outcome, count(*) AS n',
      'FROM booking_sessions',
      `WHERE tenant_id = '${tenantId}' AND opened_at >= ${since} AND closed_at IS NOT NULL`,
      'GROUP BY outcome',
      'ORDER BY n DESC',
    ].join(' '),
    dropSteps: [
      'SELECT drop_step AS step, count(*) AS n',
      'FROM booking_sessions',
      `WHERE tenant_id = '${tenantId}' AND opened_at >= ${since}`,
      "AND closed_at IS NOT NULL AND outcome IS NOT NULL AND outcome != 'agendado'",
      'GROUP BY drop_step',
      'ORDER BY n DESC',
    ].join(' '),
    maxSteps: [
      'SELECT max_step AS step, count(*) AS n',
      'FROM booking_sessions',
      `WHERE tenant_id = '${tenantId}' AND opened_at >= ${since}`,
      'GROUP BY max_step',
      'ORDER BY n DESC',
    ].join(' '),
    flowUsed: [
      'SELECT',
      '  count(*) AS fechadas,',
      '  sum(flow_used) AS com_flow,',
      '  sum(CASE WHEN outcome = \'agendado\' THEN 1 ELSE 0 END) AS agendadas',
      'FROM booking_sessions',
      `WHERE tenant_id = '${tenantId}' AND opened_at >= ${since} AND closed_at IS NOT NULL`,
    ].join(' '),
    /** Friction vem do outbox `ai.turn_decided` (T2); sem texto — só flag/termHash. */
    frictionTop: [
      'SELECT json_extract(f.value, \'$.flag\') AS flag, count(*) AS n',
      'FROM outbox_events e, json_each(json_extract(e.payload_json, \'$.friction\')) AS f',
      `WHERE e.tenant_id = '${tenantId}' AND e.type = 'ai.turn_decided'`,
      `AND e.occurred_at >= ${since}`,
      'AND json_extract(e.payload_json, \'$.sessionId\') IS NOT NULL',
      'GROUP BY flag',
      'ORDER BY n DESC',
      'LIMIT 20',
    ].join(' '),
  }
}

/**
 * @param {string[]} argv
 * @returns {{ env: string, tenantId: string, since: string | null, sinceMs: number, fromJsonl: string | null } | null}
 */
export function bookingSessionFunnelPlan(argv) {
  const args = [...argv]
  let fromJsonl = null
  const idx = args.indexOf('--from-jsonl')
  if (idx >= 0) {
    fromJsonl = args[idx + 1] ?? null
    if (!fromJsonl) return null
    args.splice(idx, 2)
  }
  const [target, tenantId, since] = args
  if (!target || !D1_ENVS.includes(target)) return null
  if (!tenantId || !TENANT_RE.test(tenantId)) return null
  if (since && !DATE_RE.test(since)) return null
  const sinceMs = since ? Date.parse(`${since}T00:00:00Z`) : 0
  if (Number.isNaN(sinceMs)) return null
  return { env: target, tenantId, since: since ?? null, sinceMs, fromJsonl }
}

/**
 * Extrai um evento de telemetria de uma linha (JSONL puro, wrangler tail, ou
 * mensagem com JSON embutido). Devolve null se não for evento T1–T3 conhecido.
 * @param {string} line
 */
export function parseTelemetryLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return null

  const tryObj = (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const event = raw.event ?? raw.type
    if (typeof event !== 'string' || !TELEMETRY_EVENTS.has(event)) return null
    return { ...raw, event }
  }

  try {
    const top = JSON.parse(trimmed)
    const direct = tryObj(top)
    if (direct) return direct
    // wrangler tail --format=json: vários envelopes possíveis
    for (const key of ['message', 'logs', 'Log', 'payload']) {
      const v = top?.[key]
      if (typeof v === 'string') {
        const nested = parseTelemetryLine(v)
        if (nested) return nested
      } else if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === 'string') {
            const nested = parseTelemetryLine(item)
            if (nested) return nested
          } else {
            const nested = tryObj(item) ?? tryObj(item?.message)
            if (nested) return nested
          }
        }
      } else if (v && typeof v === 'object') {
        const nested = tryObj(v)
        if (nested) return nested
      }
    }
    if (typeof top?.event?.Log === 'string') {
      return parseTelemetryLine(top.event.Log)
    }
  } catch {
    // pode ser texto com JSON no meio
  }

  const m = trimmed.match(/\{[\s\S]*"event"\s*:\s*"(?:booking_session\.(?:opened|ended|flow)|ai\.turn_decided)"[\s\S]*\}/)
  if (m) {
    try {
      return tryObj(JSON.parse(m[0]))
    } catch {
      return null
    }
  }
  return null
}

/**
 * @param {Iterable<string>} lines
 */
export function parseTelemetryLines(lines) {
  const events = []
  for (const line of lines) {
    const ev = parseTelemetryLine(line)
    if (ev) events.push(ev)
  }
  return events
}

function eventTime(ev) {
  const t = ev.occurredAt ?? ev.openedAt ?? ev.closedAt
  return typeof t === 'number' && Number.isFinite(t) ? t : null
}

function bump(map, key, n = 1) {
  if (key == null || key === '') return
  map.set(key, (map.get(key) ?? 0) + n)
}

/**
 * Agrega funil a partir de eventos T1–T3 (sem transcript).
 * @param {object[]} events
 * @param {{ tenantId: string, sinceMs?: number }} opts
 */
export function aggregateBookingSessionFunnel(events, opts) {
  const tenantId = opts.tenantId
  const sinceMs = opts.sinceMs ?? 0
  const outcomes = new Map()
  const dropSteps = new Map()
  const friction = new Map()
  const flowStates = new Map()
  /** @type {Map<string, { maxStepIdx: number, outcome: string | null, flowUsed: boolean, openedAt: number | null }>} */
  const sessions = new Map()

  const ensure = (sessionId) => {
    if (!sessionId) return null
    let s = sessions.get(sessionId)
    if (!s) {
      s = { maxStepIdx: -1, outcome: null, flowUsed: false, openedAt: null }
      sessions.set(sessionId, s)
    }
    return s
  }

  const inScope = (ev) => {
    if (ev.tenantId != null && ev.tenantId !== tenantId) return false
    const t = eventTime(ev)
    if (t != null && t < sinceMs) return false
    return true
  }

  for (const ev of events) {
    if (!inScope(ev)) continue
    const event = ev.event

    if (event === 'booking_session.opened') {
      const s = ensure(ev.sessionId)
      if (s) {
        s.openedAt = eventTime(ev) ?? s.openedAt
        const idx = STEP_INDEX.get('hub')
        if (idx != null && idx > s.maxStepIdx) s.maxStepIdx = idx
      }
      continue
    }

    if (event === 'booking_session.ended') {
      const s = ensure(ev.sessionId)
      if (s) {
        s.outcome = typeof ev.outcome === 'string' ? ev.outcome : s.outcome
        s.flowUsed = Boolean(ev.flowUsed) || s.flowUsed
        if (ev.dropStep && STEP_INDEX.has(ev.dropStep) && STEP_INDEX.get(ev.dropStep) > s.maxStepIdx) {
          s.maxStepIdx = STEP_INDEX.get(ev.dropStep)
        }
        if (ev.outcome === 'agendado') {
          const conf = STEP_INDEX.get('confirm')
          if (conf != null && conf > s.maxStepIdx) s.maxStepIdx = conf
        }
      }
      if (typeof ev.outcome === 'string') bump(outcomes, ev.outcome)
      if (ev.outcome && ev.outcome !== 'agendado' && ev.dropStep) bump(dropSteps, ev.dropStep)
      continue
    }

    if (event === 'booking_session.flow') {
      bump(flowStates, ev.flowState ?? 'unknown')
      const s = ensure(ev.sessionId)
      if (s && (ev.flowState === 'opened' || ev.flowState === 'completed')) s.flowUsed = true
      continue
    }

    if (event === 'ai.turn_decided') {
      const s = ensure(ev.sessionId)
      if (s && typeof ev.step === 'string' && STEP_INDEX.has(ev.step)) {
        const idx = STEP_INDEX.get(ev.step)
        if (idx > s.maxStepIdx) s.maxStepIdx = idx
      }
      const fr = Array.isArray(ev.friction) ? ev.friction : []
      for (const item of fr) {
        if (item && typeof item.flag === 'string') bump(friction, item.flag)
      }
    }
  }

  const reached = Object.fromEntries(FUNNEL_STEPS.map((step) => [step, 0]))
  let closed = 0
  let withFlow = 0
  let openStill = 0
  for (const s of sessions.values()) {
    if (s.outcome) {
      closed += 1
      if (s.flowUsed) withFlow += 1
    } else {
      openStill += 1
    }
    for (const step of FUNNEL_STEPS) {
      const idx = STEP_INDEX.get(step)
      if (idx != null && s.maxStepIdx >= idx) reached[step] += 1
    }
  }

  const sortCount = (map) =>
    [...map.entries()]
      .map(([key, n]) => ({ key, n }))
      .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))

  return {
    tenantId,
    sinceMs,
    sessionsSeen: sessions.size,
    closed,
    openStill,
    outcomes: sortCount(outcomes),
    dropSteps: sortCount(dropSteps),
    funnelReached: FUNNEL_STEPS.map((step) => ({ step, n: reached[step] })),
    topFriction: sortCount(friction),
    flowStates: sortCount(flowStates),
    flowUsedAmongClosed: { closed, withFlow },
  }
}

/** @param {ReturnType<typeof aggregateBookingSessionFunnel>} report */
export function formatFunnelReport(report) {
  const lines = []
  lines.push(`booking-session-funnel  tenant=${report.tenantId}  sinceMs=${report.sinceMs}`)
  lines.push(
    `sessões vistas=${report.sessionsSeen}  fechadas=${report.closed}  abertas=${report.openStill}`,
  )
  lines.push('')
  lines.push('Outcomes (booking_session.ended):')
  if (report.outcomes.length === 0) lines.push('  (nenhum)')
  else for (const { key, n } of report.outcomes) lines.push(`  ${key}: ${n}`)
  lines.push('')
  lines.push('Funil (sessões que alcançaram o passo — max step observado):')
  for (const { step, n } of report.funnelReached) lines.push(`  ${step}: ${n}`)
  lines.push('')
  lines.push('Drop step (fechadas ≠ agendado):')
  if (report.dropSteps.length === 0) lines.push('  (nenhum)')
  else for (const { key, n } of report.dropSteps) lines.push(`  ${key}: ${n}`)
  lines.push('')
  lines.push('Top friction (ai.turn_decided.friction.flag):')
  if (report.topFriction.length === 0) lines.push('  (nenhuma)')
  else for (const { key, n } of report.topFriction.slice(0, 20)) lines.push(`  ${key}: ${n}`)
  lines.push('')
  const { closed, withFlow } = report.flowUsedAmongClosed
  lines.push(
    `flowUsed entre fechadas: ${withFlow}/${closed}` +
      (closed ? ` (${((100 * withFlow) / closed).toFixed(1)}%)` : ''),
  )
  if (report.flowStates.length) {
    lines.push('booking_session.flow por estado:')
    for (const { key, n } of report.flowStates) lines.push(`  ${key}: ${n}`)
  }
  lines.push('')
  lines.push('Sem lista de mensagens / transcript. Sem nota LLM por sessão.')
  return lines.join('\n')
}

/**
 * Pacote operacional: SQL DO + filtros Workers Logs (sem transcript).
 * @param {{ env: string, tenantId: string, since: string | null, sinceMs: number }} plan
 */
export function formatOperationalPack(plan) {
  const sql = buildBookingSessionFunnelSql(plan.tenantId, plan.sinceMs)
  const sinceLabel = plan.since ?? '(epoch)'
  return [
    `booking-session-funnel — pacote operacional (${plan.env})`,
    `tenant=${plan.tenantId}  desde=${sinceLabel} (ms=${plan.sinceMs})`,
    '',
    'Fonte de verdade: SQLite do Clinic DO (tabela booking_sessions + outbox_events).',
    'Não está no D1 central. Sem UI de transcript neste recorte (T4).',
    '',
    '--- SQL (correr no SQLite da clínica / suporte auditado; só agregados) ---',
    '',
    '-- outcomes',
    sql.outcomes + ';',
    '',
    '-- drop_step (onde caiu)',
    sql.dropSteps + ';',
    '',
    '-- max_step alcançado',
    sql.maxSteps + ';',
    '',
    '-- flowUsed / agendadas',
    sql.flowUsed + ';',
    '',
    '-- top friction (T2, via outbox ai.turn_decided)',
    sql.frictionTop + ';',
    '',
    '--- Workers Logs (painel CF → Workers → Observability / wrangler tail) ---',
    `  event = booking_session.ended AND tenantId = ${plan.tenantId}`,
    `  event = ai.turn_decided AND tenantId = ${plan.tenantId}  (campo friction[].flag)`,
    `  event = booking_session.flow AND tenantId = ${plan.tenantId}`,
    '',
    'Agregar a partir de export JSONL:',
    `  node scripts/booking-session-funnel.mjs ${plan.env} ${plan.tenantId}${plan.since ? ` ${plan.since}` : ''} --from-jsonl ./tail.jsonl`,
    '',
    'Ver docs/implementation/runbooks/booking-session-funnel.md',
  ].join('\n')
}

function readJsonlSource(path) {
  if (path === '-') {
    return readFileSync(0, 'utf8')
  }
  return readFileSync(path, 'utf8')
}

function main() {
  const plan = bookingSessionFunnelPlan(process.argv.slice(2))
  if (!plan) {
    console.error(
      `booking-session-funnel: uso: node scripts/booking-session-funnel.mjs <${D1_ENVS.join('|')}> <tenantId> [YYYY-MM-DD] [--from-jsonl path|-]`,
    )
    process.exit(1)
  }

  const dry = process.env.TREDANE_FUNNEL_DRY_RUN === '1' || !plan.fromJsonl
  if (dry) {
    console.log(formatOperationalPack(plan))
    if (!plan.fromJsonl) process.exit(0)
    // dry com from-jsonl: ainda imprime o pacote e não agrega
    process.exit(0)
  }

  let raw
  try {
    raw = readJsonlSource(plan.fromJsonl)
  } catch (err) {
    console.error(`booking-session-funnel: não leu ${plan.fromJsonl}: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
  const events = parseTelemetryLines(raw.split(/\r?\n/))
  const report = aggregateBookingSessionFunnel(events, {
    tenantId: plan.tenantId,
    sinceMs: plan.sinceMs,
  })
  console.log(formatFunnelReport(report))
  process.exit(0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
