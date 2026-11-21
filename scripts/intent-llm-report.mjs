#!/usr/bin/env node
/**
 * Agrega eventos `ai.intent_llm` (NDJSON / Workers Observability export) para o
 * loop adaptativo offline (DEC-221 / F3). Só lê; não chama rede nem o modelo.
 *
 * Uso:
 *   node scripts/intent-llm-report.mjs eventos.ndjson
 *   cat eventos.ndjson | node scripts/intent-llm-report.mjs -
 *
 * Campos esperados (estruturados desde o PR de telemetria de outcome):
 *   label, confidence, origin, mode, closed, handler, linkPurpose, outcome
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { stdin } from 'node:process'

const path = process.argv[2]
if (!path) {
  console.error('Uso: node scripts/intent-llm-report.mjs <ficheiro.ndjson|->')
  process.exit(2)
}

const input = path === '-' ? stdin : createReadStream(path, { encoding: 'utf8' })
const rl = createInterface({ input, crlfDelay: Infinity })

const byOutcome = new Map()
const byLabel = new Map()
const byMode = new Map()
const confBuckets = new Map() // 0.0–0.1 … 0.9–1.0
const sampleWrong = []
let n = 0
let closed = 0
let withConf = 0
let confSum = 0

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function confBucket(c) {
  if (typeof c !== 'number' || !Number.isFinite(c)) return 'na'
  const b = Math.min(9, Math.max(0, Math.floor(c * 10)))
  return `${(b / 10).toFixed(1)}–${((b + 1) / 10).toFixed(1)}`
}

for await (const line of rl) {
  const t = line.trim()
  if (!t) continue
  let row
  try {
    row = JSON.parse(t)
  } catch {
    continue
  }
  if (row.event !== 'ai.intent_llm') continue
  n += 1
  bump(byOutcome, row.outcome ?? 'unknown')
  bump(byLabel, row.label ?? 'null')
  bump(byMode, row.mode ?? (row.origin === 'shadow' ? 'shadow' : 'live'))
  if (row.closed === true) closed += 1
  if (typeof row.confidence === 'number' && Number.isFinite(row.confidence)) {
    withConf += 1
    confSum += row.confidence
    bump(confBuckets, confBucket(row.confidence))
  }
  // Amostra heurística: sombra dizia fechar, ou live caiu no redator com label fechada.
  if (
    row.outcome === 'shadow_would_close' ||
    row.outcome === 'redactor' ||
    row.outcome === 'fallback'
  ) {
    if (sampleWrong.length < 30) {
      sampleWrong.push({
        label: row.label,
        confidence: row.confidence,
        outcome: row.outcome,
        handler: row.handler ?? row.linkPurpose ?? null,
        mode: row.mode,
      })
    }
  }
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '—')

const lines = [
  `ai.intent_llm: ${n} eventos`,
  `  fechados (closed=true): ${closed} (${pct(closed, n)})`,
  `  confiança média: ${withConf ? (confSum / withConf).toFixed(3) : '—'} (n=${withConf})`,
  '  por mode:',
  ...[...byMode.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `    ${k}: ${v}`),
  '  por outcome:',
  ...[...byOutcome.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `    ${k}: ${v}`),
  '  por label:',
  ...[...byLabel.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `    ${k}: ${v}`),
  '  histograma de confiança:',
  ...[...confBuckets.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([k, v]) => `    ${k}: ${v}`),
  '  amostra redator / sombra / sombra_would_close (até 30):',
  ...(sampleWrong.length
    ? sampleWrong.map(
        (s) =>
          `    [${s.mode}] ${s.label ?? 'null'} conf=${s.confidence ?? '—'} → ${s.outcome}` +
          (s.handler ? ` (${s.handler})` : ''),
      )
    : ['    (nenhuma)']),
  '',
  'Métricas do loop (Propostas): recall fechado / wrong-route / redator indevido pedem',
  'rótulo humano ou L1 — este script só agrega telemetria bruta.',
]

console.log(lines.join('\n'))
