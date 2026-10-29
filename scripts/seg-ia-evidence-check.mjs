#!/usr/bin/env node
/**
 * Verifica matriz SEG-IA S9 (#180) e imprime resumo de gates.
 * Não activa piloto nem AI_AUTOBOOK. Exit 1 se referência em falta.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED = [
  'docs/security/seg-ia-s9-e2e-validation.md',
  'docs/implementation/runbooks/ai-autobook-kill-switch.md',
  'src/seg-ia-validation/matrix.ts',
  'src/seg-ia-validation/adversarial.test.ts',
  'src/seg-ia-validation/matrix.test.ts',
  'src/clinic/ai/autobook.test.ts',
  'src/clinic/ai/prompt-injection.test.ts',
  'src/clinic/ai/abuse-limits.test.ts',
  'src/clinic/ai/context-minimization.test.ts',
  'src/clinic/proposals/execute-confirm.test.ts',
  'src/clinic/proposals/proposals.test.ts',
  'src/clinic/proposals/send.test.ts',
  'src/clinic/pix/payment.test.ts',
  'src/clinic/pix/exceptions.test.ts',
  'src/whatsapp/webhook.test.ts',
]

const matrixSrc = readFileSync(join(root, 'src/seg-ia-validation/matrix.ts'), 'utf8')
const states = [...matrixSrc.matchAll(/state:\s*'(Confirmado|Proposto|Em aberto|Fora do MVP)'/g)].map(
  (m) => m[1],
)
const ids = [...matrixSrc.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])
const testPaths = [
  ...matrixSrc.matchAll(/'(src\/[^']+\.test\.ts|docs\/[^']+\.md)'/g),
].map((m) => m[1])

const counts = { Confirmado: 0, Proposto: 0, 'Em aberto': 0, 'Fora do MVP': 0 }
for (const s of states) counts[s] += 1

const missing = []
for (const rel of [...REQUIRED, ...testPaths]) {
  if (!existsSync(join(root, rel))) missing.push(rel)
}

const hasH9 = ids.includes('S9-H9')
const hasH10 = ids.includes('S9-H10')
const hasUi = ids.includes('S9-UI')
const hasAuth = ids.includes('S9-T01') && ids.includes('S9-T12')

console.log('SEG-IA S9 evidence check (#180)')
console.log(
  JSON.stringify(
    {
      matrixIds: ids.length,
      counts,
      requiredOk: missing.length === 0,
      missing,
      hasH9,
      hasH10,
      hasUi,
      hasAuth,
      pilotActivated: false,
      aiAutobookLiberated: false,
      verdict: 'NO-GO',
      note: 'CI sintético não fecha #180 sozinho; gates humanos Em aberto',
    },
    null,
    2,
  ),
)

if (missing.length > 0) {
  console.error('Ficheiros em falta:', missing)
  process.exit(1)
}

if (!hasH9 || !hasH10 || !hasUi || !hasAuth || counts['Em aberto'] < 2) {
  console.error('Matriz incompleta: precisa S9-H9/H10/UI, auth Confirmado e Em aberto')
  process.exit(1)
}

process.exit(0)
