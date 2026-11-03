#!/usr/bin/env node
/**
 * Aplica migrações D1 remotas para staging|production.
 *
 *   node scripts/d1-migrate-remote.mjs staging
 *   node scripts/d1-migrate-remote.mjs production
 *
 * Usa CLOUDFLARE_API_TOKEN (preferir CLOUDFLARE_API_TOKEN_D1 no workflow se
 * o token de deploy não tiver D1:Edit). TREDANE_D1_DRY_RUN=1 só imprime o plano.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { D1_DATABASE_BY_ENV, D1_ENVS, d1PermissionHint } from './d1-env.mjs'

export function migratePlan(target) {
  if (!target || !D1_ENVS.includes(target)) return null
  const database = D1_DATABASE_BY_ENV[target]
  return {
    database,
    args: ['wrangler', 'd1', 'migrations', 'apply', database, '--env', target, '--remote'],
  }
}

function main() {
  const target = process.argv[2]
  const plan = migratePlan(target)
  if (!plan) {
    console.error(
      `d1-migrate-remote: ambiente explícito obrigatório (${D1_ENVS.join('|')}). Ex.: node scripts/d1-migrate-remote.mjs staging`,
    )
    process.exit(1)
  }

  const cmdline = ['npx', ...plan.args]
  if (process.env.TREDANE_D1_DRY_RUN === '1') {
    console.log(cmdline.join(' '))
    return
  }

  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.error(
      'd1-migrate-remote: CLOUDFLARE_API_TOKEN ausente. Para CI, use secrets.CLOUDFLARE_API_TOKEN_D1 ou alargue CLOUDFLARE_API_TOKEN com Account · D1: Edit (docs/DEPLOY.md).',
    )
    process.exit(1)
  }

  console.log(`d1-migrate-remote: a aplicar migrações em ${plan.database} (--env ${target} --remote)`)
  const r = spawnSync(cmdline[0], cmdline.slice(1), {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  })
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  if (r.status !== 0) {
    const hint = d1PermissionHint(r.stderr ?? '', r.stdout ?? '')
    if (hint) console.error(`::error::${hint}`)
    else {
      console.error(
        `::error::d1-migrate-remote falhou (exit ${r.status ?? 'null'}). Confirme D1:Edit no token e IDs reais em wrangler.jsonc.`,
      )
    }
    process.exit(r.status ?? 1)
  }
  console.log(`d1-migrate-remote: OK (${plan.database})`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
