#!/usr/bin/env node
/**
 * Deploy do Worker principal para um ambiente explícito.
 *
 *   npm run deploy -- staging
 *   npm run deploy -- production
 *
 * Passos (com CLOUDFLARE_ENV=<env>): build (Vite gera o wrangler.json do
 * ambiente) → confirma que o config gerado é do ambiente → check:env → wrangler
 * deploy. Recusa correr sem ambiente explícito (o build sem CLOUDFLARE_ENV gera
 * o config de desenvolvimento, `tredane-dev`).
 *
 * TREDANE_DEPLOY_DRY_RUN=1 imprime o plano sem executar nada (usado nos testes).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEPLOY_ENVS = ['staging', 'production']
const WORKER_BASE = 'tredane-dev'

export function deployPlan(target) {
  if (!target || !DEPLOY_ENVS.includes(target)) return null
  return [
    ['npm', ['run', 'build']],
    ['node', ['scripts/check-env-placeholders.mjs', target]],
    ['npx', ['wrangler', 'deploy', '--env', target]],
  ]
}

/** Lê o config redirecionado gerado pelo build e devolve o nome do Worker. */
export function builtWorkerName(cwd) {
  const redirect = resolve(cwd, '.wrangler/deploy/config.json')
  if (!existsSync(redirect)) return null
  const { configPath } = JSON.parse(readFileSync(redirect, 'utf8'))
  const cfg = resolve(dirname(redirect), configPath)
  if (!existsSync(cfg)) return null
  return JSON.parse(readFileSync(cfg, 'utf8')).name ?? null
}

function main() {
  const target = process.argv[2]
  const plan = deployPlan(target)
  if (!plan) {
    console.error(
      `deploy: ambiente explícito obrigatório (${DEPLOY_ENVS.join('|')}). Ex.: npm run deploy -- staging`,
    )
    process.exit(1)
  }
  const env = { ...process.env, CLOUDFLARE_ENV: target }
  const expectedName = `${WORKER_BASE}-${target}`
  if (process.env.TREDANE_DEPLOY_DRY_RUN === '1') {
    console.log(`CLOUDFLARE_ENV=${target}`)
    for (const [cmd, args] of plan) console.log([cmd, ...args].join(' '))
    console.log(`expect worker ${expectedName}`)
    return
  }
  for (const [i, [cmd, args]] of plan.entries()) {
    const r = spawnSync(cmd, args, { stdio: 'inherit', env })
    if (r.status !== 0) process.exit(r.status ?? 1)
    if (i === 0) {
      const name = builtWorkerName(process.cwd())
      if (name !== expectedName) {
        console.error(`deploy: build gerou "${name}", esperado "${expectedName}". Abortado.`)
        process.exit(1)
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
