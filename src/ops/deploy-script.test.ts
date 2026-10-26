import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const script = resolve(root, 'scripts/deploy.mjs')

function run(args: string[]) {
  return spawnSync('node', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TREDANE_DEPLOY_DRY_RUN: '1', CLOUDFLARE_ENV: '' },
  })
}

describe('scripts/deploy.mjs', () => {
  it('recusa correr sem ambiente explícito', () => {
    const r = run([])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('ambiente explícito obrigatório')
  })

  it.each(['development', 'dev', 'prod', '--env'])('recusa ambiente inválido %s', (env) => {
    expect(run([env]).status).toBe(1)
  })

  it.each(['staging', 'production'])('%s: build → check:env → wrangler deploy --env', (env) => {
    const r = run([env])
    expect(r.status).toBe(0)
    expect(r.stdout.trim().split('\n')).toEqual([
      `CLOUDFLARE_ENV=${env}`,
      'npm run build',
      `node scripts/check-env-placeholders.mjs ${env}`,
      `npx wrangler deploy --env ${env}`,
      `expect worker tredane-dev-${env}`,
    ])
  })
})
