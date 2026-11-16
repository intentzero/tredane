import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import { bootClinicDb } from '../clinic/test-db'
import { clinicConfig, clinicPipeline, workerCaller, type ClinicDb } from '../clinic'
import {
  clearClinicAppointments,
  OPERATIONAL_RESET_KEPT_TABLES,
  OPERATIONAL_RESET_TABLES,
  resetClinicOperationalData,
} from '../clinic/retention'
import { insertSyntheticAppointment } from '../clinic/config/appointments'
import type { WorkerBindings } from '../worker/bindings'
import { isStagingEnv } from '../security/env-gate'

const A = 'clinic-demo-a'
const B = 'clinic-demo-b'
const OWNER_A = 'user_synth_owner_a'
const ATTENDANT_A = 'user_synth_attendant_a'
const STAGING = { ENVIRONMENT: 'staging' } as WorkerBindings
const URL_A = `http://localhost/api/tenants/${A}/staging/reset-operational-data`
const CLEAR_URL_A = `http://localhost/api/tenants/${A}/staging/clear-appointments`

function count(db: ClinicDb, table: string): number {
  return Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0)
}

function seed(db: ClinicDb, clock: Parameters<typeof clinicPipeline.seedSyntheticPipelineOp>[2], tenantId: string) {
  const caller = workerCaller(tenantId, 'seed')
  clinicConfig.upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', active: true }, clock)
  clinicPipeline.seedSyntheticPipelineOp(db, caller, clock)
}

function harness() {
  const admin = bootAdminDb()
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const clinic = (tenantId: string) => {
    let boot = clinics.get(tenantId)
    if (!boot) {
      boot = bootClinicDb()
      clinics.set(tenantId, boot)
    }
    return boot
  }
  const central: Array<{ actorClerkUserId: string; tenantId: string; counts: Record<string, number> }> = []
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(admin.db),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => admin.db,
    clinicReset: {
      gatewayFactory: (_env, tenantId) => ({
        reset: async (caller) => {
          const b = clinic(tenantId)
          return resetClinicOperationalData(b.db, caller, b.clock)
        },
        clearAppointments: async (caller) => {
          const b = clinic(tenantId)
          return clearClinicAppointments(b.db, caller, b.clock)
        },
      }),
      centralAuditFactory: () => async ({ actorClerkUserId, tenantId, result }) => {
        central.push({ actorClerkUserId, tenantId, counts: result.deletedCounts })
      },
    },
  })
  const tenantName = (id: string) =>
    admin.db.get<{ name: string }>(`SELECT name FROM tenants WHERE id = ?`, id)!.name
  const post = (user: string, body: unknown, env?: WorkerBindings, url = URL_A) =>
    app.request(
      url,
      {
        method: 'POST',
        headers: { Authorization: synthAuthHeader(user), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      env,
    )
  return {
    clinic,
    central,
    tenantName,
    post,
    close: () => {
      for (const c of clinics.values()) c.close()
      admin.close()
    },
  }
}

describe('reset operacional da clínica (staging-only)', () => {
  it('isStagingEnv é estrito (fail closed)', () => {
    expect(isStagingEnv({ ENVIRONMENT: 'staging' })).toBe(true)
    for (const e of [undefined, '', 'production', 'development', 'test', 'Staging', 'prod']) {
      expect(isStagingEnv({ ENVIRONMENT: e })).toBe(false)
    }
    expect(isStagingEnv(undefined)).toBe(false)
  })

  it('as listas apagar/manter cobrem todas as tabelas do Clinic DO e as apagadas têm tenant_id', () => {
    const b = bootClinicDb()
    try {
      const tables = b.db
        .all<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
        )
        .map((r) => r.name)
      const known = new Set([...OPERATIONAL_RESET_TABLES, ...OPERATIONAL_RESET_KEPT_TABLES])
      expect(tables.filter((t) => !known.has(t))).toEqual([])
      for (const t of OPERATIONAL_RESET_TABLES) {
        expect(tables).toContain(t)
        const cols = b.db.all<{ name: string }>(`PRAGMA table_info(${t})`).map((c) => c.name)
        expect(cols, t).toContain('tenant_id')
      }
      expect(OPERATIONAL_RESET_TABLES.filter((t) => OPERATIONAL_RESET_KEPT_TABLES.includes(t))).toEqual([])
    } finally {
      b.close()
    }
  })

  it('produção recusa (404) mesmo com dono e nome certo; nada é apagado', async () => {
    const h = harness()
    try {
      const a = h.clinic(A)
      seed(a.db, a.clock, A)
      const before = count(a.db, 'conversations')
      expect(before).toBeGreaterThan(0)
      const res = await h.post(OWNER_A, { confirmName: h.tenantName(A) }, {
        ENVIRONMENT: 'production',
      } as WorkerBindings)
      expect(res.status).toBe(404)
      expect(count(a.db, 'conversations')).toBe(before)
      expect(h.central).toHaveLength(0)
    } finally {
      h.close()
    }
  })

  it('ENVIRONMENT ausente (ou development) recusa (404)', async () => {
    const h = harness()
    try {
      const name = h.tenantName(A)
      expect((await h.post(OWNER_A, { confirmName: name })).status).toBe(404)
      expect((await h.post(OWNER_A, { confirmName: name }, {} as WorkerBindings)).status).toBe(404)
      expect(
        (await h.post(OWNER_A, { confirmName: name }, { ENVIRONMENT: 'development' } as WorkerBindings))
          .status,
      ).toBe(404)
    } finally {
      h.close()
    }
  })

  it('atendente recebe 403 em staging', async () => {
    const h = harness()
    try {
      const a = h.clinic(A)
      seed(a.db, a.clock, A)
      const res = await h.post(ATTENDANT_A, { confirmName: h.tenantName(A) }, STAGING)
      expect(res.status).toBe(403)
      expect(count(a.db, 'conversations')).toBeGreaterThan(0)
    } finally {
      h.close()
    }
  })

  it('dono de outra clínica não reseta A (403)', async () => {
    const h = harness()
    try {
      const res = await h.post('user_synth_owner_b', { confirmName: h.tenantName(A) }, STAGING)
      expect(res.status).toBe(403)
    } finally {
      h.close()
    }
  })

  it('nome errado, ausente ou com outra caixa → 400; nada é apagado', async () => {
    const h = harness()
    try {
      const a = h.clinic(A)
      seed(a.db, a.clock, A)
      const before = count(a.db, 'messages')
      const name = h.tenantName(A)
      for (const body of [{ confirmName: 'Outra clínica' }, {}, { confirmName: name.toUpperCase() + 'X' }]) {
        const res = await h.post(OWNER_A, body, STAGING)
        expect(res.status).toBe(400)
        expect(((await res.json()) as { error: string }).error).toBe('confirm_name_mismatch')
      }
      expect(count(a.db, 'messages')).toBe(before)
    } finally {
      h.close()
    }
  })

  it('sucesso em staging: apaga só o tenant alvo, mantém conta/config, grava auditoria', async () => {
    const h = harness()
    try {
      const a = h.clinic(A)
      const b = h.clinic(B)
      seed(a.db, a.clock, A)
      seed(b.db, b.clock, B)
      const bBefore = Object.fromEntries(OPERATIONAL_RESET_TABLES.map((t) => [t, count(b.db, t)]))
      const keptBefore = Object.fromEntries(
        ['resources', 'clinic_settings', 'clinic_meta'].map((t) => [t, count(a.db, t)]),
      )
      expect(count(a.db, 'contacts')).toBeGreaterThan(0)
      expect(count(a.db, 'opportunities')).toBeGreaterThan(0)

      const res = await h.post(OWNER_A, { confirmName: `  ${h.tenantName(A)} ` }, STAGING)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        ok: boolean
        tenantId: string
        totalDeleted: number
        deletedCounts: Record<string, number>
        centralAudit: string
      }
      expect(body.ok).toBe(true)
      expect(body.tenantId).toBe(A)
      expect(body.totalDeleted).toBeGreaterThan(0)
      expect(body.deletedCounts.conversations).toBeGreaterThan(0)
      expect(body.centralAudit).toBe('ok')

      for (const t of OPERATIONAL_RESET_TABLES) expect(count(a.db, t), t).toBe(0)
      for (const [t, n] of Object.entries(keptBefore)) expect(count(a.db, t), t).toBe(n)
      expect(count(a.db, 'resources')).toBeGreaterThan(0)
      // Outro tenant intacto.
      for (const t of OPERATIONAL_RESET_TABLES) expect(count(b.db, t), t).toBe(bBefore[t])

      // Auditoria: DO (mesma transação) + central D1.
      const audit = a.db.get<{ actor: string; detail_json: string; tenant_id: string }>(
        `SELECT actor, detail_json, tenant_id FROM operational_audit
         WHERE action = 'clinic.operational_reset'`,
      )
      expect(audit?.actor).toBe(OWNER_A)
      expect(audit?.tenant_id).toBe(A)
      expect(JSON.parse(audit!.detail_json).deletedCounts).toEqual(body.deletedCounts)
      expect(h.central).toEqual([
        { actorClerkUserId: OWNER_A, tenantId: A, counts: body.deletedCounts },
      ])
    } finally {
      h.close()
    }
  })
})

describe('limpar agenda (staging-only)', () => {
  function seedAppointments(
    db: ClinicDb,
    clock: Parameters<typeof insertSyntheticAppointment>[3],
    tenantId: string,
  ) {
    seed(db, clock, tenantId)
    const now = clock.nowMs()
    insertSyntheticAppointment(
      db,
      tenantId,
      {
        id: `apt_past_${tenantId}`,
        serviceId: 'svc-x',
        professionalId: 'pro-x',
        startsAt: now - 86_400_000,
        endsAt: now - 86_400_000 + 3_600_000,
        contactLabel: 'Passado',
      },
      clock,
    )
    insertSyntheticAppointment(
      db,
      tenantId,
      {
        id: `apt_future_${tenantId}`,
        serviceId: 'svc-x',
        professionalId: 'pro-x',
        startsAt: now + 86_400_000,
        endsAt: now + 86_400_000 + 3_600_000,
        contactLabel: 'Futuro',
      },
      clock,
    )
    db.run(
      `INSERT INTO appointment_allocations (
        id, tenant_id, appointment_id, resource_kind, resource_id, occupied_from, occupied_until
      ) VALUES (?, ?, ?, 'professional', 'pro-x', ?, ?)`,
      `alc_future_${tenantId}`,
      tenantId,
      `apt_future_${tenantId}`,
      now + 86_400_000,
      now + 86_400_000 + 3_600_000,
    )
  }

  it('produção recusa (404); nada é apagado', async () => {
    const h = harness()
    try {
      const a = h.clinic(A)
      seedAppointments(a.db, a.clock, A)
      const before = count(a.db, 'appointments')
      expect(before).toBeGreaterThan(0)
      const res = await h.post(
        OWNER_A,
        { confirmName: h.tenantName(A) },
        { ENVIRONMENT: 'production' } as WorkerBindings,
        CLEAR_URL_A,
      )
      expect(res.status).toBe(404)
      expect(count(a.db, 'appointments')).toBe(before)
      expect(h.central).toHaveLength(0)
    } finally {
      h.close()
    }
  })

  it('atendente recebe 403; nome errado → 400', async () => {
    const h = harness()
    try {
      const a = h.clinic(A)
      seedAppointments(a.db, a.clock, A)
      const before = count(a.db, 'appointments')
      expect(
        (
          await h.post(ATTENDANT_A, { confirmName: h.tenantName(A) }, STAGING, CLEAR_URL_A)
        ).status,
      ).toBe(403)
      expect(
        (await h.post(OWNER_A, { confirmName: 'Outra' }, STAGING, CLEAR_URL_A)).status,
      ).toBe(400)
      expect(count(a.db, 'appointments')).toBe(before)
    } finally {
      h.close()
    }
  })

  it('sucesso: apaga só compromissos/holds do tenant; mantém contatos e config; idempotente', async () => {
    const h = harness()
    try {
      const a = h.clinic(A)
      const b = h.clinic(B)
      seedAppointments(a.db, a.clock, A)
      seedAppointments(b.db, b.clock, B)
      const contactsBefore = count(a.db, 'contacts')
      const conversationsBefore = count(a.db, 'conversations')
      const resourcesBefore = count(a.db, 'resources')
      const bAppointmentsBefore = count(b.db, 'appointments')
      expect(count(a.db, 'appointments')).toBeGreaterThanOrEqual(2)
      expect(contactsBefore).toBeGreaterThan(0)

      const res = await h.post(
        OWNER_A,
        { confirmName: `  ${h.tenantName(A)} ` },
        STAGING,
        CLEAR_URL_A,
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        ok: boolean
        tenantId: string
        totalDeleted: number
        deletedCounts: Record<string, number>
        centralAudit: string
      }
      expect(body.ok).toBe(true)
      expect(body.tenantId).toBe(A)
      expect(body.deletedCounts.appointments).toBeGreaterThanOrEqual(2)
      expect(body.totalDeleted).toBeGreaterThan(0)
      expect(body.centralAudit).toBe('ok')

      expect(count(a.db, 'appointments')).toBe(0)
      expect(count(a.db, 'appointment_allocations')).toBe(0)
      expect(count(a.db, 'contacts')).toBe(contactsBefore)
      expect(count(a.db, 'conversations')).toBe(conversationsBefore)
      expect(count(a.db, 'resources')).toBe(resourcesBefore)
      expect(count(b.db, 'appointments')).toBe(bAppointmentsBefore)

      const audit = a.db.get<{ actor: string; action: string }>(
        `SELECT actor, action FROM operational_audit
         WHERE action = 'clinic.appointments_cleared'`,
      )
      expect(audit?.actor).toBe(OWNER_A)
      expect(h.central).toEqual([
        { actorClerkUserId: OWNER_A, tenantId: A, counts: body.deletedCounts },
      ])

      // Idempotente: segunda chamada ok com zeros.
      const again = await h.post(
        OWNER_A,
        { confirmName: h.tenantName(A) },
        STAGING,
        CLEAR_URL_A,
      )
      expect(again.status).toBe(200)
      const againBody = (await again.json()) as { deletedCounts: Record<string, number> }
      expect(againBody.deletedCounts.appointments ?? 0).toBe(0)
    } finally {
      h.close()
    }
  })
})

