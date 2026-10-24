#!/usr/bin/env node
/**
 * Carga sintética documentada (#44).
 * Medição HTTP real exige `npm run dev` + auth; este script valida budgets
 * Propostos offline e imprime o contrato de ensaio.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const budgetsPathHint = 'src/ops/budgets.ts'
const raw = readFileSync(resolve(process.cwd(), budgetsPathHint), 'utf8')

const ids = [...raw.matchAll(/id: '([^']+)'/g)].map((m) => m[1])
console.log('ops-synthetic-load — budgets Propostos (não medidos em CF live):\n')
for (const id of ids) {
  console.log(`  - ${id}`)
}
console.log(`
Como medir localmente (dados sintéticos):
  1. npm run dev
  2. Authorization: Bearer synth:user_synth_superadmin
  3. POST /api/f6/ops/load  { "iterations": 8 }
  4. POST /api/f6/ops/recovery/rehearse
  5. Comparar p95 com PROPOSED_OPS_BUDGETS (status=proposto)

Staging live: Em aberto até check:env passar com IDs reais.
Custo por clínica em moeda: Em aberto (não inventar preços Cloudflare/Meta/Clerk).
`)
