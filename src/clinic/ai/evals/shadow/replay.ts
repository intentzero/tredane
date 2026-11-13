/**
 * Reexecução da sombra do interpretador sobre o corpus fixo (Proposto).
 *
 * Quatro sistemas contra a leitura rotulada:
 * - `rule`     léxico determinístico (`interpretTurn`);
 * - `today`    o que produção faz hoje: léxico, mais o extrator **só** se o
 *              léxico não leu nenhum campo, com citação literal obrigatória;
 * - `strict`   léxico + modelo com citação literal em todo turno;
 * - `relaxed`  só o modelo, com validação por id do catálogo (a hipótese H1);
 * - `hybrid`   léxico primeiro, o modelo preenche o que ficou vazio.
 *
 * Só a chamada ao modelo gasta dinheiro; a análise é pura e repete-se sobre a
 * saída guardada.
 */
import type { AiAssistDeps } from '../../types'
import { costUsd } from '../l2/cost'
import { EVAL_BOOKING_CATALOG } from '../booking-object-catalog'
import {
  resolveShadowSlots,
  SHADOW_FIELDS,
  toShadowSlots,
  type ShadowField,
  type ShadowSlots,
} from '../../interpreter-shadow'
import { callExtractorModel, validateExtractorOutput, type ExtractorRaw } from '../../llm-extractor'
import { interpretTurn } from '../../nlu/interpret'
import { REPLAY_CORPUS, REPLAY_TODAY, type ReplayPhrase, type ReplayTag } from './corpus'

export const SYSTEMS = ['rule', 'today', 'strict', 'relaxed', 'hybrid'] as const
export type SystemName = (typeof SYSTEMS)[number]

export type RawCall = {
  id: string
  raw: ExtractorRaw | null
  status: 'ok' | 'provider' | 'parse'
  model: string | null
  latencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
}

export type PhraseResult = {
  id: string
  text: string
  tag: ReplayTag
  expect: ShadowSlots
  got: Record<SystemName, ShadowSlots>
  /** Por sistema: campos certos, errados, em falta e a mais (inventados). */
  score: Record<SystemName, { ok: ShadowField[]; wrong: ShadowField[]; missed: ShadowField[]; spurious: ShadowField[] }>
  perfect: Record<SystemName, boolean>
}

const norm = (v: unknown): string => JSON.stringify(v)

function sameValue(a: unknown, b: unknown): boolean {
  return norm(Array.isArray(a) ? [...a].sort() : a) === norm(Array.isArray(b) ? [...b].sort() : b)
}

export function scorePhrase(
  phrase: ReplayPhrase,
  got: ShadowSlots,
): { ok: ShadowField[]; wrong: ShadowField[]; missed: ShadowField[]; spurious: ShadowField[] } {
  const out = { ok: [] as ShadowField[], wrong: [] as ShadowField[], missed: [] as ShadowField[], spurious: [] as ShadowField[] }
  for (const f of SHADOW_FIELDS) {
    if (phrase.ignore?.includes(f)) continue
    const want = phrase.expect[f]
    const have = got[f]
    if (want === undefined && have === undefined) continue
    if (want === undefined) out.spurious.push(f)
    else if (have === undefined) out.missed.push(f)
    else if (sameValue(want, have)) out.ok.push(f)
    else out.wrong.push(f)
  }
  return out
}

function merge(primary: ShadowSlots, fill: ShadowSlots): ShadowSlots {
  const out: ShadowSlots = { ...primary }
  for (const f of SHADOW_FIELDS) {
    if (out[f] === undefined && fill[f] !== undefined) (out as Record<string, unknown>)[f] = fill[f]
  }
  return out
}

export function analysePhrase(phrase: ReplayPhrase, call: RawCall | undefined): PhraseResult {
  const services = EVAL_BOOKING_CATALOG
  const base = interpretTurn({
    turnText: phrase.text,
    messageId: phrase.id,
    today: REPLAY_TODAY,
    services,
    pending: phrase.pending ? { ...phrase.pending, messageId: 'prev' } : null,
    professionals: [],
  })
  const rule = toShadowSlots(base.slots)
  const raw = call?.raw ?? null
  let strict: ShadowSlots = rule
  let relaxed: ShadowSlots = {}
  if (raw) {
    const opts = {
      messageId: phrase.id,
      turnText: phrase.text,
      today: REPLAY_TODAY,
      services,
      professionals: [] as Array<{ id: string; name: string }>,
      pending: phrase.pending ? { ...phrase.pending, messageId: 'prev' } : null,
    }
    strict = toShadowSlots(validateExtractorOutput(raw, { ...opts, base }).slots)
    relaxed = resolveShadowSlots(raw, opts).slots
  }
  const got: Record<SystemName, ShadowSlots> = {
    rule,
    today: base.needsExtractor ? strict : rule,
    strict,
    relaxed,
    hybrid: merge(rule, relaxed),
  }
  const score = {} as PhraseResult['score']
  const perfect = {} as PhraseResult['perfect']
  for (const s of SYSTEMS) {
    score[s] = scorePhrase(phrase, got[s])
    perfect[s] = score[s].wrong.length + score[s].missed.length + score[s].spurious.length === 0
  }
  return { id: phrase.id, text: phrase.text, tag: phrase.tag, expect: phrase.expect, got, score, perfect }
}

export type Summary = Record<
  SystemName,
  { phrases: number; perfect: number; fields: number; ok: number; wrong: number; missed: number; spurious: number }
>

export function summarise(results: PhraseResult[]): Summary {
  const out = {} as Summary
  for (const s of SYSTEMS) {
    out[s] = { phrases: results.length, perfect: 0, fields: 0, ok: 0, wrong: 0, missed: 0, spurious: 0 }
    for (const r of results) {
      const sc = r.score[s]
      if (r.perfect[s]) out[s].perfect += 1
      out[s].ok += sc.ok.length
      out[s].wrong += sc.wrong.length
      out[s].missed += sc.missed.length
      out[s].spurious += sc.spurious.length
      out[s].fields += sc.ok.length + sc.wrong.length + sc.missed.length
    }
  }
  return out
}

const pct = (n: number, d: number) => (d === 0 ? '—' : `${Math.round((n / d) * 100)} %`)

export function renderReport(input: {
  results: PhraseResult[]
  calls: RawCall[]
  mode: string
  model: string | null
}): string {
  const { results, calls } = input
  const sum = summarise(results)
  const lines: string[] = []
  lines.push(`# Reexecução da sombra do interpretador`)
  lines.push('')
  lines.push(`Modo: **${input.mode}** · modelo: ${input.model ?? '—'} · frases: ${results.length} · «hoje»: ${REPLAY_TODAY}`)
  lines.push('')
  lines.push('| Sistema | Frases perfeitas | Campos certos | Errados | Em falta | Inventados |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const s of SYSTEMS) {
    const x = sum[s]
    lines.push(
      `| ${s} | ${x.perfect}/${x.phrases} (${pct(x.perfect, x.phrases)}) | ${x.ok}/${x.fields} (${pct(x.ok, x.fields)}) | ${x.wrong} | ${x.missed} | ${x.spurious} |`,
    )
  }
  lines.push('')
  lines.push('Por tipo de frase (frases perfeitas):')
  lines.push('')
  const tags = [...new Set(results.map((r) => r.tag))]
  lines.push(`| Tipo | n | ${SYSTEMS.join(' | ')} |`)
  lines.push(`| --- | --- | ${SYSTEMS.map(() => '---').join(' | ')} |`)
  for (const t of tags) {
    const rs = results.filter((r) => r.tag === t)
    lines.push(`| ${t} | ${rs.length} | ${SYSTEMS.map((s) => `${rs.filter((r) => r.perfect[s]).length}`).join(' | ')} |`)
  }
  const ok = calls.filter((c) => c.status === 'ok')
  const lat = ok.map((c) => c.latencyMs ?? 0).sort((a, b) => a - b)
  const q = (p: number) => (lat.length === 0 ? null : lat[Math.min(lat.length - 1, Math.floor(p * lat.length))])
  lines.push('')
  lines.push(
    `Chamadas: ${calls.length} (${ok.length} ok, ${calls.filter((c) => c.status === 'provider').length} falha do provedor, ${calls.filter((c) => c.status === 'parse').length} saída inválida) · latência p50 ${q(0.5) ?? '—'} ms · p95 ${q(0.95) ?? '—'} ms`,
  )
  lines.push('')
  lines.push('## Onde o modelo (relaxado) acerta e o léxico de hoje não')
  lines.push('')
  const gains = results.filter((r) => !r.perfect.today && r.perfect.relaxed)
  for (const r of gains) lines.push(`- ${r.id} «${r.text}» — hoje: ${[...r.score.today.wrong, ...r.score.today.missed, ...r.score.today.spurious].join(', ')}`)
  if (gains.length === 0) lines.push('(nenhum)')
  lines.push('')
  lines.push('## Onde o modelo (relaxado) falha e o léxico de hoje acerta')
  lines.push('')
  const losses = results.filter((r) => r.perfect.today && !r.perfect.relaxed)
  for (const r of losses) {
    lines.push(`- ${r.id} «${r.text}» — modelo: errados ${r.score.relaxed.wrong.join(',') || '—'}, em falta ${r.score.relaxed.missed.join(',') || '—'}, inventados ${r.score.relaxed.spurious.join(',') || '—'}`)
  }
  if (losses.length === 0) lines.push('(nenhum)')
  lines.push('')
  lines.push('## Onde nenhum dos dois acerta (hoje e modelo relaxado)')
  lines.push('')
  const both = results.filter((r) => !r.perfect.today && !r.perfect.relaxed)
  for (const r of both) lines.push(`- ${r.id} «${r.text}» — esperado ${JSON.stringify(r.expect)}; hoje ${JSON.stringify(r.got.today)}; modelo ${JSON.stringify(r.got.relaxed)}`)
  if (both.length === 0) lines.push('(nenhum)')
  lines.push('')
  lines.push('Rótulos feitos à mão sobre o catálogo de referência; frases fictícias escritas pela equipa. Não representa clientes reais.')
  return lines.join('\n')
}

/** Chama o modelo uma vez por frase, com concorrência limitada e teto de custo. */
export async function collectCalls(
  deps: AiAssistDeps,
  opts: { phrases?: ReplayPhrase[]; concurrency?: number; budgetUsd?: number; timeoutMs?: number } = {},
): Promise<{ calls: RawCall[]; spentUsd: number; truncated: boolean }> {
  const phrases = opts.phrases ?? REPLAY_CORPUS
  const budget = opts.budgetUsd ?? 2
  const concurrency = opts.concurrency ?? 4
  const calls: RawCall[] = []
  let spent = 0
  let truncated = false
  let next = 0
  const worker = async () => {
    for (;;) {
      if (spent >= budget) {
        truncated = true
        return
      }
      const i = next++
      if (i >= phrases.length) return
      const p = phrases[i]!
      try {
        const res = await callExtractorModel(deps, {
          turnText: p.text,
          pending: p.pending ? { ...p.pending, messageId: 'prev' } : null,
          services: EVAL_BOOKING_CATALOG,
          professionals: [],
          timeoutMs: opts.timeoutMs ?? 20_000,
        })
        const g = res.gen
        if (g.ok) {
          spent += costUsd({ model: g.model, inputTokens: g.inputTokens ?? 0, outputTokens: g.outputTokens ?? 0 })
        }
        calls.push({
          id: p.id,
          raw: res.raw,
          status: !g.ok ? 'provider' : res.raw ? 'ok' : 'parse',
          model: g.model,
          latencyMs: g.latencyMs,
          inputTokens: g.ok ? g.inputTokens : null,
          outputTokens: g.ok ? g.outputTokens : null,
        })
      } catch {
        calls.push({ id: p.id, raw: null, status: 'provider', model: null, latencyMs: null, inputTokens: null, outputTokens: null })
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return { calls, spentUsd: spent, truncated }
}
