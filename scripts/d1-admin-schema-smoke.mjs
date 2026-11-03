#!/usr/bin/env node
/**
 * Smoke obrigatório: admin_schema_state.version == ADMIN_SCHEMA_VERSION no D1 remoto.
 *
 *   node scripts/d1-admin-schema-smoke.mjs staging
 *   node scripts/d1-admin-schema-smoke.mjs production
 *
 * Bloqueia promoção do Worker se o schema admin estiver atrasado (evita 500
 * SchemaNotReady em /api/me/tenants etc.). TREDANE_D1_DRY_RUN=1 só imprime o plano.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  D1_DATABASE_BY_ENV,
  D1_ENVS,
  d1PermissionHint,
  parseAdminSchemaVersionFromExecuteJson,
  readAdminSchemaVersion,
} from './d1-env.mjs'

const SQL = 'SELECT version FROM admin_schema_state WHERE id = 1'

export function smokePlan(target) {
  if (!target || !D1_ENVS.includes(target)) return null
  const database = D1_DATABASE_BY_ENV[target]
  return {
    database,
    args: [
      'wrangler',
      'd1',
      'execute',
      database,
      '--env',
      target,
      '--remote',
      '--json',
      '--command',
      SQL,
    ],
  }
}

function main() {
  const target = process.argv[2]
  const plan = smokePlan(target)
  if (!plan) {
    console.error(
      `d1-admin-schema-smoke: ambiente explícito obrigatório (${D1_ENVS.join('|')}). Ex.: node scripts/d1-admin-schema-smoke.mjs staging`,
    )
    process.exit(1)
  }

  const expected = readAdminSchemaVersion()
  const cmdline = ['npx', ...plan.args]

  if (process.env.TREDANE_D1_DRY_RUN === '1') {
    console.log(`expect ADMIN_SCHEMA_VERSION=${expected}`)
    console.log(cmdline.join(' '))
    return
  }

  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.error(
      'd1-admin-schema-smoke: CLOUDFLARE_API_TOKEN ausente. Para CI, use secrets.CLOUDFLARE_API_TOKEN_D1 ou alargue CLOUDFLARE_API_TOKEN com Account · D1: Edit (docs/DEPLOY.md).',
    )
    process.exit(1)
  }

  console.log(
    `d1-admin-schema-smoke: a ler admin_schema_state em ${plan.database} (esperado ${expected})`,
  )
  const r = spawnSync(cmdline[0], cmdline.slice(1), {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  })
  const out = r.stdout ?? ''
  const err = r.stderr ?? ''
  if (r.status !== 0) {
    if (out) process.stdout.write(out)
    if (err) process.stderr.write(err)
    const hint = d1PermissionHint(err, out)
    if (hint) console.error(`::error::${hint}`)
    else {
      console.error(
        `::error::d1-admin-schema-smoke: wrangler d1 execute falhou (exit ${r.status ?? 'null'}).`,
      )
    }
    process.exit(r.status ?? 1)
  }

  let actual
  try {
    actual = parseAdminSchemaVersionFromExecuteJson(out)
  } catch (e) {
    if (out) process.stdout.write(out)
    if (err) process.stderr.write(err)
    console.error(`::error::d1-admin-schema-smoke: ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }

  if (actual !== expected) {
    console.error(
      `::error::d1-admin-schema-smoke FALHOU: admin_schema_state.version=${actual}, código espera ADMIN_SCHEMA_VERSION=${expected}. Apply migrações D1 antes de publicar o Worker (ordem: migrate → smoke → deploy).`,
    )
    process.exit(1)
  }

  console.log(`d1-admin-schema-smoke: PASS (version=${actual} == ${expected})`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
