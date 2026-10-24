#!/usr/bin/env node
/**
 * Verifica ficheiros da matriz MVP-31 (#45) e imprime resumo go/no-go.
 * Não activa piloto. Exit 1 se referência em falta.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED = [
  'docs/product/evidence-matrix.md',
  'docs/implementation/f6-e2e-validation.md',
  'src/mvp-validation/matrix.ts',
  'src/mvp-validation/fixtures.ts',
  'src/mvp-validation/journey.e2e.test.ts',
  'src/mvp-validation/exceptions.e2e.test.ts',
  'src/mvp-validation/api-roles.http.test.ts',
  'src/worker/runtime.harness.test.ts',
  'src/clinic/pix/exceptions.test.ts',
  'src/clinic/ai/ai.test.ts',
  'src/whatsapp/send.test.ts',
  'src/ops/ops.test.ts',
]

const matrixSrc = readFileSync(join(root, 'src/mvp-validation/matrix.ts'), 'utf8')
const states = [...matrixSrc.matchAll(/state:\s*'(Confirmado|Proposto|Em aberto|Fora do MVP)'/g)].map(
  (m) => m[1],
)
const ids = [...matrixSrc.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])
const testPaths = [...matrixSrc.matchAll(/'(src\/[^']+\.test\.ts|docs\/[^']+\.md)'/g)].map(
  (m) => m[1],
)

const counts = { Confirmado: 0, Proposto: 0, 'Em aberto': 0, 'Fora do MVP': 0 }
for (const s of states) counts[s] += 1

const missing = []
for (const rel of [...REQUIRED, ...testPaths]) {
  if (!existsSync(join(root, rel))) missing.push(rel)
}

console.log('MVP-31 evidence check (#45)')
console.log(
  JSON.stringify(
    {
      matrixIds: ids.length,
      counts,
      requiredOk: missing.length === 0,
      missing,
      pilotActivated: false,
      verdict: 'NO-GO',
    },
    null,
    2,
  ),
)

if (missing.length > 0) {
  console.error('Ficheiros em falta:', missing)
  process.exit(1)
}

if (!ids.includes('AC-54') || counts['Em aberto'] < 1) {
  console.error('Matriz incompleta: precisa AC-54 e pelo menos um Em aberto')
  process.exit(1)
}

process.exit(0)
