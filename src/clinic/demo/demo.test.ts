import { describe, expect, it } from 'vitest'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { DEMO_CLINIC_TENANT_ID, isDemoTenantId } from './ids'
import { seedDemoClinicOp } from './seed'
import { isDemoSeedEnabled } from '../../ops/demo-seed'

const OWNER = 'user_demo_owner_test'

describe('clínica demo (backlog item 3)', () => {
  it('cria agenda cheia, conversas e acompanhamento — idempotente', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller(DEMO_CLINIC_TENANT_ID, OWNER)
      const first = seedDemoClinicOp(db, caller, clock, { ownerClerkUserId: OWNER })
      expect(first.services).toBe(9)
      expect(first.resources).toBe(6)
      expect(first.conversationsCreated).toBe(10)
      expect(first.opportunitiesCreated).toBe(10)
      expect(first.appointmentsCreated).toBeGreaterThan(150)

      const again = seedDemoClinicOp(db, caller, clock, { ownerClerkUserId: OWNER })
      expect(again.appointmentsCreated).toBe(0)
      expect(again.conversationsCreated).toBe(0)
      const n = (sql: string) => db.get<{ n: number }>(sql, DEMO_CLINIC_TENANT_ID)!.n
      expect(n('SELECT COUNT(*) AS n FROM resources WHERE tenant_id = ?')).toBe(6)
      expect(n('SELECT COUNT(*) AS n FROM services WHERE tenant_id = ?')).toBe(9)
      expect(n('SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?')).toBe(first.appointmentsCreated)

      // Sem sobreposição por profissional.
      const overlaps = n(`SELECT COUNT(*) AS n FROM appointments a JOIN appointments b
        ON a.tenant_id = b.tenant_id AND a.professional_id = b.professional_id AND a.id < b.id
        AND a.starts_at < b.ends_at AND b.starts_at < a.ends_at WHERE a.tenant_id = ?`)
      expect(overlaps).toBe(0)

      // Nenhum «Paulo» como paciente; números não roteáveis (DDD 00).
      const names = db.all<{ display_name: string; wa_id: string }>(
        'SELECT display_name, wa_id FROM contacts WHERE tenant_id = ?',
        DEMO_CLINIC_TENANT_ID,
      )
      const labels = db.all<{ contact_label: string }>(
        'SELECT contact_label FROM appointments WHERE tenant_id = ?',
        DEMO_CLINIC_TENANT_ID,
      )
      for (const x of [...names.map((r) => r.display_name), ...labels.map((r) => r.contact_label)]) {
        expect(x).not.toMatch(/paulo/i)
      }
      for (const r of names) expect(r.wa_id.startsWith('5500')).toBe(true)
    } finally {
      close()
    }
  })

  it('recusa tenants que não são demo', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      expect(() =>
        seedDemoClinicOp(db, workerCaller('tenant_b40dc579540c30130840b9ac', OWNER), clock, {
          ownerClerkUserId: OWNER,
        }),
      ).toThrow()
      expect(isDemoTenantId('tenant_b40dc579540c30130840b9ac')).toBe(false)
      expect(isDemoTenantId(DEMO_CLINIC_TENANT_ID)).toBe(true)
    } finally {
      close()
    }
  })

  it('rota de seed só existe em staging com flag e token', () => {
    const token = 'x'.repeat(40)
    expect(isDemoSeedEnabled({ ENVIRONMENT: 'staging', DEMO_SEED_ENABLED: 'true', DEMO_SEED_TOKEN: token })).toBe(true)
    expect(isDemoSeedEnabled({ ENVIRONMENT: 'production', DEMO_SEED_ENABLED: 'true', DEMO_SEED_TOKEN: token })).toBe(false)
    expect(isDemoSeedEnabled({ ENVIRONMENT: 'staging', DEMO_SEED_ENABLED: 'true' })).toBe(false)
    expect(isDemoSeedEnabled({ ENVIRONMENT: 'staging', DEMO_SEED_TOKEN: token })).toBe(false)
  })
})
