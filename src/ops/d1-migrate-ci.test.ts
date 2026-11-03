import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseAdminSchemaVersionFromExecuteJson,
  readAdminSchemaVersion,
} from '../../scripts/d1-env.mjs'
import { migratePlan } from '../../scripts/d1-migrate-remote.mjs'
import { smokePlan } from '../../scripts/d1-admin-schema-smoke.mjs'

const root = resolve(__dirname, '../..')

function run(script: string, args: string[]) {
  return spawnSync('node', [resolve(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TREDANE_D1_DRY_RUN: '1', CLOUDFLARE_API_TOKEN: '' },
  })
}

describe('d1 migrate/smoke CI helpers', () => {
  it('readAdminSchemaVersion reflecte constants.ts', () => {
    expect(readAdminSchemaVersion(root)).toBe(16)
  })

  it('parseAdminSchemaVersionFromExecuteJson lê results[].version', () => {
    expect(
      parseAdminSchemaVersionFromExecuteJson([
        { results: [{ version: 16 }], success: true },
      ]),
    ).toBe(16)
    expect(
      parseAdminSchemaVersionFromExecuteJson(
        JSON.stringify({ result: [{ results: [{ version: 14 }] }] }),
      ),
    ).toBe(14)
  })

  it('migratePlan staging aponta tredane-staging --remote', () => {
    expect(migratePlan('staging')).toEqual({
      database: 'tredane-staging',
      args: [
        'wrangler',
        'd1',
        'migrations',
        'apply',
        'tredane-staging',
        '--env',
        'staging',
        '--remote',
      ],
    })
  })

  it('smokePlan production aponta execute --json', () => {
    const plan = smokePlan('production')
    expect(plan?.database).toBe('tredane-production')
    expect(plan?.args).toContain('--remote')
    expect(plan?.args).toContain('--json')
    expect(plan?.args).toContain('SELECT version FROM admin_schema_state WHERE id = 1')
  })

  it('dry-run migrate recusa ambiente inválido', () => {
    expect(run('scripts/d1-migrate-remote.mjs', []).status).toBe(1)
    expect(run('scripts/d1-migrate-remote.mjs', ['dev']).status).toBe(1)
  })

  it('dry-run migrate staging imprime wrangler apply', () => {
    const r = run('scripts/d1-migrate-remote.mjs', ['staging'])
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe(
      'npx wrangler d1 migrations apply tredane-staging --env staging --remote',
    )
  })

  it('dry-run smoke staging imprime expect + execute', () => {
    const r = run('scripts/d1-admin-schema-smoke.mjs', ['staging'])
    expect(r.status).toBe(0)
    const lines = r.stdout.trim().split('\n')
    expect(lines[0]).toBe('expect ADMIN_SCHEMA_VERSION=16')
    expect(lines[1]).toContain('npx wrangler d1 execute tredane-staging')
    expect(lines[1]).toContain('--remote')
    expect(lines[1]).toContain('--json')
  })
})
