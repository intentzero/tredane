import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')

function run(script: string, args: string[]) {
  return spawnSync('node', [resolve(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TREDANE_D1_DRY_RUN: '1', CLOUDFLARE_API_TOKEN: '' },
  })
}

describe('scripts/d1-migrate-remote.mjs + d1-admin-schema-smoke.mjs', () => {
  it('constants.ts expõe ADMIN_SCHEMA_VERSION numérico', () => {
    const text = readFileSync(resolve(root, 'src/db/admin/constants.ts'), 'utf8')
    const m = text.match(/export const ADMIN_SCHEMA_VERSION\s*=\s*(\d+)/)
    expect(m?.[1]).toBe('20')
  })

  it('dry-run migrate recusa ambiente inválido', () => {
    expect(run('scripts/d1-migrate-remote.mjs', []).status).toBe(1)
    expect(run('scripts/d1-migrate-remote.mjs', ['dev']).status).toBe(1)
  })

  it('dry-run migrate staging imprime wrangler apply --remote', () => {
    const r = run('scripts/d1-migrate-remote.mjs', ['staging'])
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe(
      'npx wrangler d1 migrations apply tredane-staging --env staging --remote',
    )
  })

  it('dry-run migrate production aponta tredane-production', () => {
    const r = run('scripts/d1-migrate-remote.mjs', ['production'])
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe(
      'npx wrangler d1 migrations apply tredane-production --env production --remote',
    )
  })

  it('dry-run smoke recusa ambiente inválido', () => {
    expect(run('scripts/d1-admin-schema-smoke.mjs', []).status).toBe(1)
  })

  it('dry-run smoke staging imprime expect + execute --json', () => {
    const r = run('scripts/d1-admin-schema-smoke.mjs', ['staging'])
    expect(r.status).toBe(0)
    const lines = r.stdout.trim().split('\n')
    expect(lines[0]).toBe('expect ADMIN_SCHEMA_VERSION=20')
    expect(lines[1]).toContain('npx wrangler d1 execute tredane-staging')
    expect(lines[1]).toContain('--env staging')
    expect(lines[1]).toContain('--remote')
    expect(lines[1]).toContain('--json')
    expect(lines[1]).toContain('SELECT version FROM admin_schema_state WHERE id = 1')
  })
})
