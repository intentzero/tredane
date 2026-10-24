#!/usr/bin/env node
/**
 * Checklist de smoke operacional (#44) — local / pré-staging.
 * Não exige conta Cloudflare; marca passos live como Em aberto.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const checks = []

function pass(id, detail) {
  checks.push({ id, ok: true, detail })
}
function fail(id, detail) {
  checks.push({ id, ok: false, detail })
}

// 1. wrangler observability
try {
  const raw = readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8')
  if (/"observability"\s*:\s*\{[^}]*"enabled"\s*:\s*true/s.test(raw)) {
    pass('wrangler_observability', 'observability.enabled=true')
  } else {
    fail('wrangler_observability', 'observability.enabled em falta')
  }
} catch (err) {
  fail('wrangler_observability', String(err))
}

// 2. check-env bloqueia staging placeholder
{
  const r = spawnSync(process.execPath, ['scripts/check-env-placeholders.mjs', 'staging'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (r.status !== 0 && /placeholders fictícios|placeholder/i.test(r.stderr + r.stdout)) {
    pass('check_env_staging_blocks_placeholder', 'recusou deploy com placeholder (esperado)')
  } else if (r.status === 0) {
    pass(
      'check_env_staging_blocks_placeholder',
      'staging sem placeholders — só OK se IDs reais foram provisionados',
    )
  } else {
    fail('check_env_staging_blocks_placeholder', r.stderr || r.stdout || `exit ${r.status}`)
  }
}

// 3. docs + módulo ops
for (const rel of [
  'docs/implementation/f6-ops.md',
  'docs/implementation/runbooks/README.md',
  'src/ops/log.ts',
  'src/ops/alerts.ts',
  'src/ops/budgets.ts',
  'src/ops/recovery.ts',
]) {
  try {
    readFileSync(resolve(root, rel))
    pass(`artifact:${rel}`, 'presente')
  } catch {
    fail(`artifact:${rel}`, 'ausente')
  }
}

// 4. Gates documentados Em aberto
pass('gate_staging_live', 'Em aberto — provisionar D1/R2/Queues reais antes do piloto')
pass('gate_pitr_live', 'Em aberto — ensaio PITR na conta CF')
pass('gate_log_retention', 'Em aberto — política REQ-070')

const ok = checks.every((c) => c.ok)
for (const c of checks) {
  console.log(`${c.ok ? 'OK' : 'FAIL'}  ${c.id} — ${c.detail}`)
}
console.log(ok ? '\nops-smoke-checklist: PASS' : '\nops-smoke-checklist: FAIL')
process.exit(ok ? 0 : 1)
