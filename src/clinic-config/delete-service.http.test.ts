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
import { insertSyntheticAppointment } from '../clinic/config'
import type { ClinicDb } from '../clinic/store'
import { createMemoryClinicConfigRegistry } from './gateway'

const BASE = 'http://localhost/api/tenants'

function harness() {
  const admin = bootAdminDb()
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const boot = (tenantId: string) => {
    let b = clinics.get(tenantId)
    if (!b) {
      b = bootClinicDb()
      clinics.set(tenantId, b)
    }
    return b
  }
  const registry = createMemoryClinicConfigRegistry((tenantId) => {
    const b = boot(tenantId)
    return { db: b.db, clock: b.clock }
  })
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(admin.db),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => admin.db,
    clinicConfigGatewayFactory: (_env, tenantId) => registry(tenantId),
  })
  const req = (user: string, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', synthAuthHeader(user))
    if (init.body) headers.set('Content-Type', 'application/json')
    return app.request(`${BASE}/${path}`, { ...init, headers })
  }
  return {
    req,
    boot,
    close: () => {
      for (const c of clinics.values()) c.close()
      admin.close()
    },
  }
}

const OWNER = 'user_synth_owner_a'
const ATTENDANT = 'user_synth_attendant_a'
const TENANT = 'clinic-demo-a'

async function setup(h: ReturnType<typeof harness>) {
  const pro = await h.req(OWNER, `${TENANT}/config/resources`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'professional', name: 'Dra. Fictícia Teste' }),
  })
  const proId = ((await pro.json()) as { id: string }).id
  const svc = await h.req(OWNER, `${TENANT}/config/services`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Limpeza fictícia',
      durationMinutes: 60,
      bufferMinutes: 0,
      professionalIds: [proId],
      roomRequirement: { mode: 'none' },
    }),
  })
  expect(svc.status).toBe(201)
  const body = (await svc.json()) as { id: string; deletable: boolean }
  return { proId, serviceId: body.id, deletable: body.deletable }
}

/** Insere linha fictícia preenchendo NOT NULL sem default a partir do schema. */
function insertRow(db: ClinicDb, table: string, values: Record<string, unknown>) {
  const cols = db.all<{ name: string; notnull: number; dflt_value: unknown; type: string }>(
    `PRAGMA table_info(${table})`,
  )
  const row: Record<string, unknown> = {}
  for (const c of cols) {
    if (c.name in values) row[c.name] = values[c.name]
    else if (c.notnull && c.dflt_value == null) {
      row[c.name] = /INT/i.test(c.type) ? 1 : `synth_${c.name}`
    }
  }
  const names = Object.keys(row)
  db.run(
    `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    ...names.map((n) => row[n] as never),
  )
}

function countRows(db: ClinicDb, sql: string, ...args: string[]) {
  return db.get<{ n: number }>(sql, ...args)?.n ?? 0
}

describe('DELETE /config/services/:id — apagar serviço sem marcações', () => {
  it('owner apaga serviço sem histórico; vínculos e auditoria na mesma operação', async () => {
    const h = harness()
    try {
      const { serviceId, deletable } = await setup(h)
      expect(deletable).toBe(true)
      const db = h.boot(TENANT).db
      expect(countRows(db, `SELECT COUNT(*) AS n FROM service_professionals WHERE service_id = ?`, serviceId)).toBe(1)

      const res = await h.req(OWNER, `${TENANT}/config/services/${serviceId}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, id: serviceId })

      expect(countRows(db, `SELECT COUNT(*) AS n FROM services WHERE id = ?`, serviceId)).toBe(0)
      expect(countRows(db, `SELECT COUNT(*) AS n FROM service_professionals WHERE service_id = ?`, serviceId)).toBe(0)
      expect(countRows(db, `SELECT COUNT(*) AS n FROM service_room_requirements WHERE service_id = ?`, serviceId)).toBe(0)
      const audit = db.get<{ actor: string; detail_json: string }>(
        `SELECT actor, detail_json FROM operational_audit WHERE action = 'config.service_deleted' AND object_id = ?`,
        serviceId,
      )
      expect(audit?.actor).toBe(OWNER)
      expect(JSON.parse(audit!.detail_json)).toMatchObject({ name: 'Limpeza fictícia' })

      const again = await h.req(OWNER, `${TENANT}/config/services/${serviceId}`, { method: 'DELETE' })
      expect(again.status).toBe(404)
    } finally {
      h.close()
    }
  })

  it('attendant não apaga (403); owner de outra clínica não apaga (403)', async () => {
    const h = harness()
    try {
      const { serviceId } = await setup(h)
      const att = await h.req(ATTENDANT, `${TENANT}/config/services/${serviceId}`, { method: 'DELETE' })
      expect(att.status).toBe(403)
      const cross = await h.req('user_synth_owner_b', `${TENANT}/config/services/${serviceId}`, { method: 'DELETE' })
      expect(cross.status).toBe(403)
      // Mesmo id na clínica B: não existe lá.
      const inB = await h.req('user_synth_owner_b', `clinic-demo-b/config/services/${serviceId}`, { method: 'DELETE' })
      expect(inB.status).toBe(404)
      const db = h.boot(TENANT).db
      expect(countRows(db, `SELECT COUNT(*) AS n FROM services WHERE id = ?`, serviceId)).toBe(1)
    } finally {
      h.close()
    }
  })

  for (const status of ['confirmed', 'cancelled'] as const) {
    it(`recusa com 409 quando há marcação ${status} (mesmo passada)`, async () => {
      const h = harness()
      try {
        const { serviceId, proId } = await setup(h)
        const b = h.boot(TENANT)
        insertSyntheticAppointment(
          b.db,
          TENANT,
          { serviceId, professionalId: proId, startsAt: 1_000, endsAt: 2_000, status, contactLabel: 'Cliente Fictícia' },
          b.clock,
        )
        const snap = await h.req(OWNER, `${TENANT}/config`)
        const svc = ((await snap.json()) as { services: Array<{ id: string; deletable: boolean }> }).services.find(
          (s) => s.id === serviceId,
        )
        expect(svc?.deletable).toBe(false)

        const res = await h.req(OWNER, `${TENANT}/config/services/${serviceId}`, { method: 'DELETE' })
        expect(res.status).toBe(409)
        const body = (await res.json()) as { error: string; message: string }
        expect(body.error).toBe('service_has_appointments')
        expect(body.message).toMatch(/Desative/)
        expect(countRows(b.db, `SELECT COUNT(*) AS n FROM services WHERE id = ?`, serviceId)).toBe(1)
        expect(countRows(b.db, `SELECT COUNT(*) AS n FROM service_professionals WHERE service_id = ?`, serviceId)).toBe(1)
        expect(
          countRows(b.db, `SELECT COUNT(*) AS n FROM operational_audit WHERE action = 'config.service_deleted'`),
        ).toBe(0)
      } finally {
        h.close()
      }
    })
  }

  it('recusa com 409 quando há Pix pendente ligado ao serviço', async () => {
    const h = harness()
    try {
      const { serviceId } = await setup(h)
      const db = h.boot(TENANT).db
      insertRow(db, 'pix_charges', { id: 'pix_synth_1', tenant_id: TENANT, service_id: serviceId, status: 'awaiting_payment' })
      const res = await h.req(OWNER, `${TENANT}/config/services/${serviceId}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
      expect(((await res.json()) as { error: string }).error).toBe('service_has_pending_pix')
    } finally {
      h.close()
    }
  })

  it('recusa com 409 quando há proposta de horário pendente', async () => {
    const h = harness()
    try {
      const { serviceId } = await setup(h)
      const db = h.boot(TENANT).db
      insertRow(db, 'schedule_holds', { id: 'hold_synth_1', tenant_id: TENANT, service_id: serviceId, status: 'active', window_starts_at: 1_000, window_ends_at: 2_000 })
      const res = await h.req(OWNER, `${TENANT}/config/services/${serviceId}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
      expect(((await res.json()) as { error: string }).error).toBe('service_has_pending_proposal')
    } finally {
      h.close()
    }
  })

  it('recusa com 409 quando só há histórico de proposta já encerrada', async () => {
    const h = harness()
    try {
      const { serviceId } = await setup(h)
      const db = h.boot(TENANT).db
      insertRow(db, 'schedule_holds', { id: 'hold_synth_2', tenant_id: TENANT, service_id: serviceId, status: 'expired', window_starts_at: 1_000, window_ends_at: 2_000 })
      const res = await h.req(OWNER, `${TENANT}/config/services/${serviceId}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
      expect(((await res.json()) as { error: string }).error).toBe('service_has_history')
    } finally {
      h.close()
    }
  })
})
