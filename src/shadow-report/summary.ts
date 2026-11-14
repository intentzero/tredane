/**
 * TEMPORÁRIO: resumo agregado dos eventos da sombra (o mesmo que scripts/interpreter-shadow-report.mjs,
 * mas sobre as linhas do D1). Ver hipotese-compreensao-llm-primeiro.md §5.3d.
 */
import { SHADOW_FIELDS, type ShadowField, type ShadowVerdict } from '../clinic/ai/interpreter-shadow'
import type { ShadowEventRow } from './store'

/** USD por milhão de tokens do Haiku 5.5: taxas Propostas (evals/l2/cost.ts). */
const HAIKU_RATE = { input: 0.1, output: 0.5 }
const VERDICTS: ShadowVerdict[] = ['agree', 'differ', 'llm_only', 'rule_only', 'none']

export type ShadowSummary = {
  total: number
  conversations: number
  tenants: number
  byStatus: Record<string, number>
  compared: number
  reusedMainCall: number
  mainModelCalled: number
  diverged: number
  fields: Record<ShadowField, Record<ShadowVerdict, number>>
  strictDiscarded: Record<string, number>
  relaxedRejected: Record<string, number>
  pendingSlot: Record<string, number>
  coverage: { low: number; high: number }
  latencyMs: { p50: number | null; p95: number | null; n: number }
  tokens: { input: number; output: number; usd: number }
  /** Ids internos (conversa e mensagem) de divergências, para rotular no painel. */
  samples: {
    differ: Array<{ tenantId: string; conversationId: string; messageId: string; fields: string[] }>
    llmOnly: Array<{ tenantId: string; conversationId: string; messageId: string; fields: string[] }>
  }
}

function parse<T>(text: string | null): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1
}

function quantile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
}

export function summariseShadowRows(rows: ShadowEventRow[], opts: { sample?: number } = {}): ShadowSummary {
  const sample = opts.sample ?? 0
  const s: ShadowSummary = {
    total: rows.length,
    conversations: new Set(rows.map((r) => `${r.tenant_id}/${r.conversation_id}`)).size,
    tenants: new Set(rows.map((r) => r.tenant_id)).size,
    byStatus: {},
    compared: 0,
    reusedMainCall: 0,
    mainModelCalled: 0,
    diverged: 0,
    fields: Object.fromEntries(
      SHADOW_FIELDS.map((f) => [f, Object.fromEntries(VERDICTS.map((v) => [v, 0]))]),
    ) as ShadowSummary['fields'],
    strictDiscarded: {},
    relaxedRejected: {},
    pendingSlot: {},
    coverage: { low: 0, high: 0 },
    latencyMs: { p50: null, p95: null, n: 0 },
    tokens: { input: 0, output: 0, usd: 0 },
    samples: { differ: [], llmOnly: [] },
  }
  const lat: number[] = []
  for (const r of rows) {
    bump(s.byStatus, r.status)
    if (r.reused_main_call) s.reusedMainCall += 1
    if (r.main_model_called) s.mainModelCalled += 1
    bump(s.pendingSlot, r.pending_slot ?? '(nenhuma)')
    if (typeof r.rule_coverage === 'number') s.coverage[r.rule_coverage < 0.55 ? 'low' : 'high'] += 1
    if (typeof r.latency_ms === 'number') lat.push(r.latency_ms)
    if (!r.reused_main_call) {
      s.tokens.input += r.input_tokens ?? 0
      s.tokens.output += r.output_tokens ?? 0
    }
    const fields = parse<Record<ShadowField, ShadowVerdict>>(r.fields_json)
    if (r.status !== 'ok' || !fields) continue
    s.compared += 1
    if (r.diverged) s.diverged += 1
    for (const f of SHADOW_FIELDS) {
      const v = fields[f]
      if (v && s.fields[f][v] != null) s.fields[f][v] += 1
    }
    for (const d of parse<string[]>(r.strict_discarded_json) ?? []) bump(s.strictDiscarded, d)
    for (const x of parse<string[]>(r.relaxed_rejected_json) ?? []) bump(s.relaxedRejected, x)
    if (sample > 0) {
      const ref = { tenantId: r.tenant_id, conversationId: r.conversation_id, messageId: r.message_id }
      const differ = parse<string[]>(r.differ_json) ?? []
      const llmOnly = parse<string[]>(r.llm_only_json) ?? []
      if (differ.length > 0 && s.samples.differ.length < sample) s.samples.differ.push({ ...ref, fields: differ })
      if (llmOnly.length > 0 && s.samples.llmOnly.length < sample) s.samples.llmOnly.push({ ...ref, fields: llmOnly })
    }
  }
  lat.sort((a, b) => a - b)
  s.latencyMs = { p50: quantile(lat, 0.5), p95: quantile(lat, 0.95), n: lat.length }
  s.tokens.usd = (s.tokens.input / 1e6) * HAIKU_RATE.input + (s.tokens.output / 1e6) * HAIKU_RATE.output
  return s
}
