#!/usr/bin/env node
/**
 * T5 / DEC-148: ritual semanal — amostra de sessões com friction / abandon
 * + backlog de candidatos a stop-word/sinónimo (só lista, sem auto-apply).
 *
 *   node scripts/booking-session-weekly-sample.mjs staging <tenantId> [desde=YYYY-MM-DD] [--n 10] [--from-jsonl path|-]
 *
 * Sem `--from-jsonl`: pacote operacional (SQL amostra no Clinic DO + unmatched_terms
 * DEC-141 + passos do checklist). Não aplica nada.
 *
 * Com `--from-jsonl`: ficha Markdown com até N sessões prioritárias e backlog
 * de sugestões (termHash / flag / kind). Sem corpo de mensagem; sem juiz LLM;
 * sem escrever ZONE_MENTION_STOP nem unmatched_terms.
 *
 * Reutiliza o parser/agregador do T4 (`booking-session-funnel.mjs`).
 * TREDANE_WEEKLY_DRY_RUN=1 força só o pacote.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { D1_ENVS } from './d1-env.mjs'
import {
  aggregateBookingSessionFunnel,
  parseTelemetryLines,
} from './booking-session-funnel.mjs'

const TENANT_RE = /^[A-Za-z0-9_-]{1,80}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_N = 10
const MAX_N = 50

/** Flags que sugerem candidato a stop-word (não sinónimo de serviço). */
const STOP_WORD_FLAGS = new Set(['particle_as_zone'])
/** kind de nao_encontrei que aponta stop vs sinónimo. */
const PARTICLE_KINDS = new Set(['particle_suspected'])
const CATALOG_KINDS = new Set(['catalog'])

/**
 * @param {string} tenantId
 * @param {number} sinceMs
 * @param {number} limit
 */
export function buildWeeklySampleSql(tenantId, sinceMs, limit) {
  if (!TENANT_RE.test(tenantId)) throw new Error(`tenantId inválido: ${tenantId}`)
  if (!Number.isSafeInteger(sinceMs) || sinceMs < 0) throw new Error('instante inválido')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_N) {
    throw new Error(`N inválido (1..${MAX_N})`)
  }
  const since = sinceMs
  const n = limit
  return {
    abandonHandoff: [
      'SELECT session_id, conversation_id, outcome, drop_step, inbound_turns, flow_used,',
      '  opened_at, closed_at',
      'FROM booking_sessions',
      `WHERE tenant_id = '${tenantId}' AND opened_at >= ${since}`,
      'AND closed_at IS NOT NULL',
      "AND outcome IN ('abandon', 'handoff')",
      'ORDER BY closed_at DESC',
      `LIMIT ${n}`,
    ].join(' '),
    withFriction: [
      'SELECT DISTINCT json_extract(e.payload_json, \'$.sessionId\') AS session_id,',
      '  json_extract(f.value, \'$.flag\') AS flag,',
      '  json_extract(f.value, \'$.kind\') AS kind,',
      '  json_extract(f.value, \'$.termHash\') AS term_hash,',
      '  e.occurred_at',
      'FROM outbox_events e, json_each(json_extract(e.payload_json, \'$.friction\')) AS f',
      `WHERE e.tenant_id = '${tenantId}' AND e.type = 'ai.turn_decided'`,
      `AND e.occurred_at >= ${since}`,
      'AND json_extract(e.payload_json, \'$.sessionId\') IS NOT NULL',
      'AND json_extract(f.value, \'$.flag\') IS NOT NULL',
      'ORDER BY e.occurred_at DESC',
      `LIMIT ${n * 5}`,
    ].join(' '),
    /** Irmã do cartão DEC-141 — termo em claro só aqui / no painel; nunca no analytics. */
    unmatchedOpen: [
      'SELECT id, term, hits, status, first_seen_at, last_seen_at',
      'FROM unmatched_terms',
      `WHERE tenant_id = '${tenantId}' AND status = 'aberto'`,
      'ORDER BY hits DESC, last_seen_at DESC, id',
      'LIMIT 20',
    ].join(' '),
  }
}

/**
 * @param {string[]} argv
 * @returns {{ env: string, tenantId: string, since: string | null, sinceMs: number, n: number, fromJsonl: string | null } | null}
 */
export function weeklySamplePlan(argv) {
  const args = [...argv]
  let fromJsonl = null
  let n = DEFAULT_N

  const jsonlIdx = args.indexOf('--from-jsonl')
  if (jsonlIdx >= 0) {
    fromJsonl = args[jsonlIdx + 1] ?? null
    if (!fromJsonl) return null
    args.splice(jsonlIdx, 2)
  }
  const nIdx = args.indexOf('--n')
  if (nIdx >= 0) {
    const raw = args[nIdx + 1]
    if (raw == null || !/^\d+$/.test(raw)) return null
    n = Number(raw)
    if (!Number.isSafeInteger(n) || n < 1 || n > MAX_N) return null
    args.splice(nIdx, 2)
  }

  const [target, tenantId, since] = args
  if (!target || !D1_ENVS.includes(target)) return null
  if (!tenantId || !TENANT_RE.test(tenantId)) return null
  if (since && !DATE_RE.test(since)) return null
  const sinceMs = since ? Date.parse(`${since}T00:00:00Z`) : 0
  if (Number.isNaN(sinceMs)) return null
  return { env: target, tenantId, since: since ?? null, sinceMs, n, fromJsonl }
}

function eventTime(ev) {
  const t = ev.occurredAt ?? ev.openedAt ?? ev.closedAt
  return typeof t === 'number' && Number.isFinite(t) ? t : null
}

/**
 * Classifica um item de friction como candidato a stop-word, sinónimo, ou nenhum.
 * @param {{ flag?: string, kind?: string, termHash?: string }} item
 * @returns {'stop_word' | 'synonym' | null}
 */
export function suggestLexiconKind(item) {
  if (!item || typeof item.flag !== 'string') return null
  if (STOP_WORD_FLAGS.has(item.flag)) return 'stop_word'
  if (item.flag === 'nao_encontrei') {
    if (item.kind && PARTICLE_KINDS.has(item.kind)) return 'stop_word'
    if (item.kind && CATALOG_KINDS.has(item.kind)) return 'synonym'
    // zone / desconhecido: humano decide na ficha — não forçar sinónimo
    return null
  }
  return null
}

/**
 * Prioriza sessões com friction ou outcome abandon/handoff; devolve amostra ≤ n.
 * @param {object[]} events
 * @param {{ tenantId: string, sinceMs?: number, n?: number }} opts
 */
export function sampleWeeklySessions(events, opts) {
  const tenantId = opts.tenantId
  const sinceMs = opts.sinceMs ?? 0
  const n = opts.n ?? DEFAULT_N
  /** @type {Map<string, {
   *   sessionId: string,
   *   conversationId: string | null,
   *   outcome: string | null,
   *   dropStep: string | null,
   *   flowUsed: boolean,
   *   openedAt: number | null,
   *   closedAt: number | null,
   *   friction: Map<string, { flag: string, kind?: string, termHash?: string, count: number }>,
   *   priority: number,
   * }>} */
  const sessions = new Map()

  const ensure = (sessionId) => {
    if (!sessionId || typeof sessionId !== 'string') return null
    let s = sessions.get(sessionId)
    if (!s) {
      s = {
        sessionId,
        conversationId: null,
        outcome: null,
        dropStep: null,
        flowUsed: false,
        openedAt: null,
        closedAt: null,
        friction: new Map(),
        priority: 0,
      }
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
    const s = ensure(ev.sessionId)
    if (!s) continue
    if (typeof ev.conversationId === 'string') s.conversationId = ev.conversationId

    if (ev.event === 'booking_session.opened') {
      s.openedAt = eventTime(ev) ?? s.openedAt
      continue
    }
    if (ev.event === 'booking_session.ended') {
      s.outcome = typeof ev.outcome === 'string' ? ev.outcome : s.outcome
      s.dropStep = typeof ev.dropStep === 'string' ? ev.dropStep : s.dropStep
      s.flowUsed = Boolean(ev.flowUsed) || s.flowUsed
      s.closedAt = eventTime(ev) ?? s.closedAt
      if (s.outcome === 'abandon' || s.outcome === 'handoff') s.priority = Math.max(s.priority, 2)
      continue
    }
    if (ev.event === 'booking_session.flow') {
      if (ev.flowState === 'opened' || ev.flowState === 'completed') s.flowUsed = true
      continue
    }
    if (ev.event === 'ai.turn_decided') {
      const fr = Array.isArray(ev.friction) ? ev.friction : []
      for (const item of fr) {
        if (!item || typeof item.flag !== 'string') continue
        const key = `${item.flag}|${item.kind ?? ''}|${item.termHash ?? ''}`
        const prev = s.friction.get(key)
        if (prev) prev.count += 1
        else {
          s.friction.set(key, {
            flag: item.flag,
            ...(typeof item.kind === 'string' ? { kind: item.kind } : {}),
            ...(typeof item.termHash === 'string' ? { termHash: item.termHash } : {}),
            count: 1,
          })
        }
        s.priority = Math.max(s.priority, 3)
      }
    }
  }

  const eligible = [...sessions.values()].filter(
    (s) => s.priority > 0 || s.outcome === 'abandon' || s.outcome === 'handoff' || s.friction.size > 0,
  )
  eligible.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    const tb = b.closedAt ?? b.openedAt ?? 0
    const ta = a.closedAt ?? a.openedAt ?? 0
    return tb - ta
  })

  const sample = eligible.slice(0, n).map((s) => ({
    sessionId: s.sessionId,
    conversationId: s.conversationId,
    outcome: s.outcome,
    dropStep: s.dropStep,
    flowUsed: s.flowUsed,
    openedAt: s.openedAt,
    closedAt: s.closedAt,
    friction: [...s.friction.values()].sort(
      (a, b) => b.count - a.count || a.flag.localeCompare(b.flag),
    ),
    humanLabel: '', // preencher: ok | bug | stop_candidate | synonym_candidate | unclear
    notes: '',
  }))

  /** @type {Map<string, { suggest: 'stop_word' | 'synonym', flag: string, kind?: string, termHash?: string, hits: number, sessionIds: Set<string> }>} */
  const backlogMap = new Map()
  for (const s of sample) {
    for (const fr of s.friction) {
      const suggest = suggestLexiconKind(fr)
      if (!suggest) continue
      const key = `${suggest}|${fr.flag}|${fr.kind ?? ''}|${fr.termHash ?? ''}`
      let row = backlogMap.get(key)
      if (!row) {
        row = {
          suggest,
          flag: fr.flag,
          ...(fr.kind ? { kind: fr.kind } : {}),
          ...(fr.termHash ? { termHash: fr.termHash } : {}),
          hits: 0,
          sessionIds: new Set(),
        }
        backlogMap.set(key, row)
      }
      row.hits += fr.count
      row.sessionIds.add(s.sessionId)
    }
  }

  const backlog = [...backlogMap.values()]
    .map((r) => ({
      suggest: r.suggest,
      flag: r.flag,
      kind: r.kind ?? null,
      termHash: r.termHash ?? null,
      hits: r.hits,
      sessionIds: [...r.sessionIds].sort(),
      /** Termo em claro: preencher no painel / unmatched_terms — nunca auto. */
      termPlain: '',
      decision: '', // approve_stop | approve_synonym_DEC141 | discard | defer
    }))
    .sort((a, b) => b.hits - a.hits || a.suggest.localeCompare(b.suggest))

  return {
    tenantId,
    sinceMs,
    n,
    eligibleCount: eligible.length,
    sample,
    backlog,
    autoApply: false,
  }
}

/**
 * @param {ReturnType<typeof sampleWeeklySessions>} sheet
 * @param {ReturnType<typeof aggregateBookingSessionFunnel> | null} funnel
 */
export function formatWeeklySampleMarkdown(sheet, funnel) {
  const lines = []
  lines.push(`# Ritual semanal booking_session — amostra (T5)`)
  lines.push('')
  lines.push(`- tenant: \`${sheet.tenantId}\``)
  lines.push(`- sinceMs: ${sheet.sinceMs}`)
  lines.push(`- N pedido: ${sheet.n} · elegíveis: ${sheet.eligibleCount} · na ficha: ${sheet.sample.length}`)
  lines.push(`- **auto-apply: ${sheet.autoApply}** (Confirmado: nunca neste script — DEC-141 / DEC-104)`)
  lines.push('')
  if (funnel) {
    lines.push('## Funil (T4, mesmo JSONL)')
    lines.push('')
    lines.push(
      `Sessões vistas=${funnel.sessionsSeen} fechadas=${funnel.closed} · outcomes: ` +
        (funnel.outcomes.length
          ? funnel.outcomes.map((o) => `${o.key}=${o.n}`).join(', ')
          : '(nenhum)'),
    )
    lines.push(
      'Top friction: ' +
        (funnel.topFriction.length
          ? funnel.topFriction
              .slice(0, 8)
              .map((f) => `${f.key}=${f.n}`)
              .join(', ')
          : '(nenhuma)'),
    )
    lines.push('')
  }
  lines.push('## Amostra para rotular (painel da clínica)')
  lines.push('')
  lines.push(
    '| # | sessionId | conversationId | outcome | dropStep | friction | rótulo humano | notas |',
  )
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  if (sheet.sample.length === 0) {
    lines.push('| — | (vazia) | — | — | — | — | — | sem friction/abandon no JSONL |')
  } else {
    sheet.sample.forEach((s, i) => {
      const fr =
        s.friction.length === 0
          ? '—'
          : s.friction
              .map((f) => {
                const parts = [f.flag]
                if (f.kind) parts.push(f.kind)
                if (f.termHash) parts.push(`#${f.termHash}`)
                return `${parts.join('/') }×${f.count}`
              })
              .join('; ')
      lines.push(
        `| ${i + 1} | \`${s.sessionId}\` | ${s.conversationId ? `\`${s.conversationId}\`` : '—'} | ${s.outcome ?? '—'} | ${s.dropStep ?? '—'} | ${fr} |  |  |`,
      )
    })
  }
  lines.push('')
  lines.push('Rótulos: `ok` · `bug` · `stop_candidate` · `synonym_candidate` · `unclear`')
  lines.push('')
  lines.push('## Backlog de candidatos (só lista)')
  lines.push('')
  lines.push(
    '| suggest | flag | kind | termHash | hits | sessions | termo (humano) | decisão |',
  )
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  if (sheet.backlog.length === 0) {
    lines.push('| — | — | — | — | — | — | — | sem candidato léxico nesta amostra |')
  } else {
    for (const b of sheet.backlog) {
      lines.push(
        `| **${b.suggest}** | ${b.flag} | ${b.kind ?? '—'} | ${b.termHash ? `\`${b.termHash}\`` : '—'} | ${b.hits} | ${b.sessionIds.map((id) => `\`${id}\``).join(' ')} |  |  |`,
      )
    }
  }
  lines.push('')
  lines.push('Decisões: `approve_stop` (PR + L1) · `approve_synonym_DEC141` (owner no M-63) · `discard` · `defer`')
  lines.push('')
  lines.push('## Proibições')
  lines.push('')
  lines.push('- Não gravar sinónimo nem stop-list a partir deste ficheiro.')
  lines.push('- Não colar transcript / corpo de mensagem aqui.')
  lines.push('- Não decidir DEC-143 só com esta amostra.')
  lines.push('')
  lines.push('Ver `docs/implementation/runbooks/booking-session-weekly-ritual.md`.')
  return lines.join('\n')
}

/**
 * @param {{ env: string, tenantId: string, since: string | null, sinceMs: number, n: number }} plan
 */
export function formatWeeklyOperationalPack(plan) {
  const sql = buildWeeklySampleSql(plan.tenantId, plan.sinceMs, plan.n)
  const sinceLabel = plan.since ?? '(epoch)'
  return [
    `booking-session-weekly-sample — pacote ritual T5 (${plan.env})`,
    `tenant=${plan.tenantId}  desde=${sinceLabel} (ms=${plan.sinceMs})  N=${plan.n}`,
    '',
    'Só lista / checklist. Sem auto-apply (DEC-141). Sem transcript Admin. Sem juiz LLM.',
    '',
    '--- Checklist (marcar na nota da semana) ---',
    '[ ] Funil T4 corrido',
    '[ ] Amostra N gerada (JSONL ou SQL abaixo)',
    '[ ] Rótulos humanos no painel da clínica',
    '[ ] Backlog stop/synonym preenchido (termo em claro da conversa ou unmatched_terms)',
    '[ ] Aplicações humanas: M-63 e/ou PR — zero writes deste script',
    '',
    '--- SQL amostra (Clinic DO) ---',
    '',
    '-- abandon / handoff recentes',
    sql.abandonHandoff + ';',
    '',
    '-- friction recente (termHash, sem texto)',
    sql.withFriction + ';',
    '',
    '-- unmatched_terms abertos (DEC-141, termo em claro só aqui)',
    sql.unmatchedOpen + ';',
    '',
    '--- Comandos ---',
    `  node scripts/booking-session-funnel.mjs ${plan.env} ${plan.tenantId}${plan.since ? ` ${plan.since}` : ''}`,
    `  node scripts/booking-session-weekly-sample.mjs ${plan.env} ${plan.tenantId}${plan.since ? ` ${plan.since}` : ''} --n ${plan.n} --from-jsonl ./tail.jsonl`,
    '',
    'Ver docs/implementation/runbooks/booking-session-weekly-ritual.md',
  ].join('\n')
}

function readJsonlSource(path) {
  if (path === '-') return readFileSync(0, 'utf8')
  return readFileSync(path, 'utf8')
}

function main() {
  const plan = weeklySamplePlan(process.argv.slice(2))
  if (!plan) {
    console.error(
      `booking-session-weekly-sample: uso: node scripts/booking-session-weekly-sample.mjs <${D1_ENVS.join('|')}> <tenantId> [YYYY-MM-DD] [--n ${DEFAULT_N}] [--from-jsonl path|-]`,
    )
    process.exit(1)
  }

  const dry = process.env.TREDANE_WEEKLY_DRY_RUN === '1' || !plan.fromJsonl
  if (dry) {
    console.log(formatWeeklyOperationalPack(plan))
    process.exit(0)
  }

  let raw
  try {
    raw = readJsonlSource(plan.fromJsonl)
  } catch (err) {
    console.error(
      `booking-session-weekly-sample: não leu ${plan.fromJsonl}: ${err instanceof Error ? err.message : err}`,
    )
    process.exit(1)
  }
  const events = parseTelemetryLines(raw.split(/\r?\n/))
  const funnel = aggregateBookingSessionFunnel(events, {
    tenantId: plan.tenantId,
    sinceMs: plan.sinceMs,
  })
  const sheet = sampleWeeklySessions(events, {
    tenantId: plan.tenantId,
    sinceMs: plan.sinceMs,
    n: plan.n,
  })
  console.log(formatWeeklySampleMarkdown(sheet, funnel))
  process.exit(0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
