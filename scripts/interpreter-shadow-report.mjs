#!/usr/bin/env node
/**
 * Resume os eventos `ai.interpreter_shadow` (sombra do interpretador LLM; Proposto).
 * Ver docs/architecture/hipotese-compreensao-llm-primeiro.md §5.
 *
 *   npx wrangler tail --env staging --format json > sombra.ndjson   # deixar correr; Ctrl-C
 *   node scripts/interpreter-shadow-report.mjs sombra.ndjson [--json] [--sample 20]
 *   cat sombra.ndjson | node scripts/interpreter-shadow-report.mjs
 *
 * Aceita qualquer texto em que os eventos apareçam: uma linha JSON por evento, a saída do
 * `wrangler tail --format json` (objetos indentados em várias linhas; o evento vem como string
 * dentro de `logs[].message`) ou uma exportação dos Workers Logs. Só lê; não chama rede nem o modelo.
 *
 * Privacidade: os eventos já não levam texto da conversa. O relatório mostra só contagens;
 * `--sample N` acrescenta ids internos (conversa e mensagem) de divergências, para abrir no
 * painel e rotular à mão. Esses ids são dados do tenant: não os partilhar fora da equipa.
 *
 * O que NÃO diz: sem rótulo humano, `llm_only` não prova que o modelo acertou nem `differ`
 * que errou. É a lista do que rever, não uma taxa de acerto.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SHADOW_EVENT = 'ai.interpreter_shadow'
export const SHADOW_FIELDS = ['service', 'variants', 'line', 'professional', 'date', 'period', 'time', 'option']
export const VERDICTS = ['agree', 'differ', 'llm_only', 'rule_only', 'none']
/** USD por milhão de tokens (entrada, saída) do Haiku 5.5: taxas Propostas em evals/l2/cost.ts. */
export const HAIKU_RATE = { input: 0.1, output: 0.5 }

function walk(value, out, depth = 0) {
  if (depth > 8 || value == null) return
  if (typeof value === 'string') {
    const t = value.trim()
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        walk(JSON.parse(t), out, depth + 1)
      } catch {
        // texto que só parece JSON
      }
    }
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) walk(v, out, depth + 1)
    return
  }
  if (typeof value === 'object') {
    if (value.event === SHADOW_EVENT) {
      out.push(value)
      return
    }
    for (const v of Object.values(value)) walk(v, out, depth + 1)
  }
}

/**
 * Valores JSON de topo consecutivos num texto: uma linha por valor (NDJSON) ou, como no
 * `wrangler tail --format json`, objetos indentados em várias linhas. Ignora o texto solto
 * entre valores (cabeçalhos, avisos). Respeita strings e escapes ao contar chavetas.
 */
export function jsonValuesIn(text) {
  const out = []
  const src = String(text)
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch !== '{' && ch !== '[') {
      i += 1
      continue
    }
    let depth = 0
    let inStr = false
    let esc = false
    let j = i
    for (; j < src.length; j++) {
      const c = src[j]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === '{' || c === '[') depth += 1
      else if (c === '}' || c === ']') {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (depth !== 0) break // valor truncado no fim (Ctrl-C a meio)
    try {
      out.push(JSON.parse(src.slice(i, j + 1)))
      i = j + 1
    } catch {
      i += 1 // chaveta que não abre um JSON (texto solto): tenta a seguinte
    }
  }
  return out
}

/** Extrai e deduplica (por conversa + mensagem) os eventos da sombra de um texto qualquer. */
export function extractShadowEvents(text) {
  const found = []
  for (const value of jsonValuesIn(text)) walk(value, found)
  const seen = new Set()
  const out = []
  for (const e of found) {
    const key = `${e.conversationId ?? ''}|${e.messageId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

function quantile(sorted, p) {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

function bump(map, key, n = 1) {
  map[key] = (map[key] ?? 0) + n
}

export function summariseShadowEvents(events, opts = {}) {
  const sample = opts.sample ?? 0
  const s = {
    total: events.length,
    conversations: new Set(events.map((e) => e.conversationId)).size,
    tenants: new Set(events.map((e) => e.tenantId)).size,
    byStatus: {},
    compared: 0,
    reusedMainCall: 0,
    mainModelCalled: 0,
    diverged: 0,
    fields: Object.fromEntries(SHADOW_FIELDS.map((f) => [f, Object.fromEntries(VERDICTS.map((v) => [v, 0]))])),
    strictDiscarded: {},
    relaxedRejected: {},
    pendingSlot: {},
    coverage: { low: 0, high: 0 },
    latencyMs: { p50: null, p95: null, n: 0 },
    tokens: { input: 0, output: 0, usd: 0 },
    samples: { differ: [], llmOnly: [] },
  }
  const lat = []
  for (const e of events) {
    bump(s.byStatus, e.status ?? 'desconhecido')
    if (e.reusedMainCall) s.reusedMainCall += 1
    if (e.mainModelCalled) s.mainModelCalled += 1
    bump(s.pendingSlot, e.pendingSlot ?? '(nenhuma)')
    if (typeof e.ruleCoverage === 'number') s.coverage[e.ruleCoverage < 0.55 ? 'low' : 'high'] += 1
    if (typeof e.latencyMs === 'number') lat.push(e.latencyMs)
    // Chamada reutilizada do caminho real não é custo da sombra.
    if (!e.reusedMainCall) {
      s.tokens.input += e.inputTokens ?? 0
      s.tokens.output += e.outputTokens ?? 0
    }
    if (e.status !== 'ok' || !e.fields) continue
    s.compared += 1
    if (e.diverged) s.diverged += 1
    for (const f of SHADOW_FIELDS) {
      const v = e.fields[f]
      if (v && s.fields[f][v] != null) s.fields[f][v] += 1
    }
    for (const d of e.strictDiscarded ?? []) bump(s.strictDiscarded, d)
    for (const r of e.relaxedRejected ?? []) bump(s.relaxedRejected, r)
    if (sample > 0) {
      const ref = { conversationId: e.conversationId, messageId: e.messageId }
      if ((e.differ ?? []).length > 0 && s.samples.differ.length < sample) {
        s.samples.differ.push({ ...ref, fields: e.differ })
      }
      if ((e.llmOnly ?? []).length > 0 && s.samples.llmOnly.length < sample) {
        s.samples.llmOnly.push({ ...ref, fields: e.llmOnly })
      }
    }
  }
  lat.sort((a, b) => a - b)
  s.latencyMs = { p50: quantile(lat, 0.5), p95: quantile(lat, 0.95), n: lat.length }
  s.tokens.usd = (s.tokens.input / 1e6) * HAIKU_RATE.input + (s.tokens.output / 1e6) * HAIKU_RATE.output
  return s
}

const pct = (n, d) => (d === 0 ? '—' : `${Math.round((n / d) * 100)} %`)

export function renderShadowReport(s) {
  const L = []
  L.push('# Sombra do interpretador LLM: resumo dos eventos', '')
  if (s.total === 0) {
    L.push('Nenhum evento `ai.interpreter_shadow` encontrado. Confirmar que o deploy de staging inclui a sombra,')
    L.push('que `AI_INTERPRETER_SHADOW=on` está no Worker e que houve mensagens de texto livre.')
    return L.join('\n')
  }
  L.push(
    `Eventos: **${s.total}** · conversas: ${s.conversations} · tenants: ${s.tenants} · comparados: ${s.compared} (${pct(s.compared, s.total)})`,
  )
  L.push(
    `Estado: ${Object.entries(s.byStatus).map(([k, v]) => `${k} ${v}`).join(', ')} · extrator já chamado pelo caminho real: ${s.mainModelCalled} · saída reutilizada: ${s.reusedMainCall}`,
  )
  L.push(`Divergiram do léxico em pelo menos um campo: **${s.diverged}/${s.compared}** (${pct(s.diverged, s.compared)})`)
  L.push('', '## Campo a campo', '')
  L.push('| Campo | concordam | só o modelo leu | só o léxico leu | contradizem-se | nenhum leu |')
  L.push('| --- | --- | --- | --- | --- | --- |')
  for (const f of SHADOW_FIELDS) {
    const c = s.fields[f]
    L.push(`| ${f} | ${c.agree} | ${c.llm_only} | ${c.rule_only} | ${c.differ} | ${c.none} |`)
  }
  L.push('', '**Como ler:** «só o modelo leu» é o ganho potencial de inverter a compreensão; «contradizem-se» é o')
  L.push('risco e precisa de rótulo humano; «só o léxico leu» é o que o modelo perderia. Sem rótulo, nenhuma')
  L.push('destas colunas diz quem tem razão.')
  const list = (m) => (Object.keys(m).length === 0 ? '(nada)' : Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '))
  L.push('', '## Validação', '')
  L.push(`- O validador de hoje (citação literal) recusaria: ${list(s.strictDiscarded)}`)
  L.push(`- Nem a validação por id aceita: ${list(s.relaxedRejected)}`)
  L.push('', '## Contexto dos turnos', '')
  L.push(`- Cobertura do léxico < 0,55: ${s.coverage.low} · ≥ 0,55: ${s.coverage.high}`)
  L.push(`- Pergunta pendente: ${list(s.pendingSlot)}`)
  L.push('', '## Custo e latência (da sombra)', '')
  L.push(`- Latência: p50 ${s.latencyMs.p50 ?? '—'} ms · p95 ${s.latencyMs.p95 ?? '—'} ms (n=${s.latencyMs.n})`)
  L.push(`- Tokens: ${s.tokens.input} entrada, ${s.tokens.output} saída · ≈ US$ ${s.tokens.usd.toFixed(4)} (taxas Propostas do Haiku 5.5)`)
  if (s.samples.differ.length + s.samples.llmOnly.length > 0) {
    L.push('', '## Amostra para rotular (ids internos; abrir no painel)', '')
    for (const [name, rows] of [['Contradizem-se', s.samples.differ], ['Só o modelo leu', s.samples.llmOnly]]) {
      if (rows.length === 0) continue
      L.push(`**${name}**`)
      for (const r of rows) L.push(`- conversa ${r.conversationId} · mensagem ${r.messageId} · campos: ${r.fields.join(', ')}`)
      L.push('')
    }
  }
  return L.join('\n')
}

function main(argv) {
  const args = argv.slice(2)
  const json = args.includes('--json')
  const si = args.indexOf('--sample')
  const sample = si >= 0 ? Number(args[si + 1]) || 0 : 0
  const files = args.filter((a, i) => !a.startsWith('--') && !(si >= 0 && i === si + 1))
  const text = files.length > 0 ? files.map((f) => readFileSync(f, 'utf8')).join('\n') : readFileSync(0, 'utf8')
  const summary = summariseShadowEvents(extractShadowEvents(text), { sample })
  process.stdout.write(`${json ? JSON.stringify(summary, null, 2) : renderShadowReport(summary)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv)
