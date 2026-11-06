/**
 * DEC-143 (medida b): script do funil do Flow. Só dry-run; não toca no D1 remoto.
 */
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — script .mjs sem tipos
import { buildFlowFunnelSql, flowFunnelPlan } from '../../scripts/flow-funnel.mjs'
import { bootAdminDb } from '../db/test-db'

const root = resolve(__dirname, '../..')

describe('scripts/flow-funnel.mjs', () => {
  it('exige ambiente e tenant válidos', () => {
    expect(flowFunnelPlan([])).toBeNull()
    expect(flowFunnelPlan(['staging'])).toBeNull()
    expect(flowFunnelPlan(['staging', "x' OR 1=1 --"])).toBeNull()
    expect(flowFunnelPlan(['staging', 'clinic-a', '06/11/2026'])).toBeNull()
    expect(flowFunnelPlan(['staging', 'clinic-a', '2026-11-06'])?.database).toBe('tredane-staging')
  })

  it('dry-run imprime o comando sem executar', () => {
    const r = spawnSync('node', [resolve(root, 'scripts/flow-funnel.mjs'), 'staging', 'clinic-a'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, TREDANE_D1_DRY_RUN: '1' },
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('wrangler d1 execute tredane-staging --env staging --remote')
  })

  it('conta enviados, abertos, concluídos, substituídos e expirados', () => {
    const { db, raw, close } = bootAdminDb()
    try {
      // Só a contagem interessa aqui; tenant e binding de teste não existem.
      ;(raw as DatabaseSync).exec('PRAGMA foreign_keys = OFF')
      const ins = (token: string, o: { opened?: number; consumed?: number; replaced?: string; expires: number }) =>
        db.run(
          `INSERT INTO whatsapp_flow_tokens (token, tenant_id, binding_id, phone_number_id, waba_id,
             conversation_id, catalog_version, created_at, expires_at, replaced_by, consumed_at, session_json, opened_at)
           VALUES (?, 'clinic-a', 'b', 'p', 'w', ?, '1', 1000, ?, ?, ?, '{}', ?)`,
          token,
          `cnv-${token}`,
          o.expires,
          o.replaced ?? null,
          o.consumed ?? null,
          o.opened ?? null,
        )
      ins('t1', { expires: 9000 }) // enviado, ainda válido
      ins('t2', { opened: 1100, expires: 9000 }) // aberto, a meio
      ins('t3', { opened: 1100, consumed: 1200, expires: 9000 }) // concluído
      ins('t4', { consumed: 1300, replaced: 't5', expires: 9000 }) // substituído
      ins('t5', { expires: 2000 }) // expirado sem abrir
      const sql = buildFlowFunnelSql('clinic-a', 0, 5000) as string
      const row = (raw as DatabaseSync).prepare(sql).get() as Record<string, number>
      expect(row).toEqual({ enviados: 5, abertos: 2, concluidos: 1, substituidos: 1, expirados: 1 })
    } finally {
      close()
    }
  })
})
