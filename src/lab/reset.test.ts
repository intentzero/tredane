import { describe, expect, it, vi } from 'vitest'
import { createControllableClock } from '../db/clock'
import { workerCaller } from '../clinic'
import { DEMO_CLINIC_TENANT_ID } from '../clinic/demo/ids'
import { upsertContact } from '../clinic/contacts'
import { createConversation } from '../clinic/inbox/conversations'
import { bootClinicDb } from '../clinic/test-db'
import { labResetAgenda } from './reset'
import { assertLabResetAllowed, LabResetGuardError } from './reset-guards'
import { callLabTool } from './routes'
import type { WorkerBindings } from '../worker/bindings'

const NOW = Date.UTC(2026, 10, 16, 15, 0)
const HOUR = 3_600_000
const WA_A = '550000000101'
const WA_B = '550000000102'
const OTHER_TENANT = 'tenant_aaaaaaaaaaaaaaaaaaaaaaa'

function seedAgenda() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db, close } = boot
  const caller = workerCaller(DEMO_CLINIC_TENANT_ID, 'lab:test')
  const cA = upsertContact(db, { tenantId: DEMO_CLINIC_TENANT_ID, waId: WA_A, displayName: 'Cliente A' }, clock)
  const cB = upsertContact(db, { tenantId: DEMO_CLINIC_TENANT_ID, waId: WA_B, displayName: 'Cliente B' }, clock)
  const convA = createConversation(db, { tenantId: DEMO_CLINIC_TENANT_ID, contactId: cA.id, status: 'open' }, clock)
  createConversation(db, { tenantId: DEMO_CLINIC_TENANT_ID, contactId: cB.id, status: 'open' }, clock)

  const appt = (
    id: string,
    tenantId: string,
    contactId: string,
    startsAt: number,
    status: 'confirmed' | 'cancelled' = 'confirmed',
  ) => {
    db.run(
      `INSERT INTO appointments (
        id, tenant_id, service_id, professional_id, starts_at, ends_at, status,
        created_at, contact_id, confirmed_by
      ) VALUES (?, ?, 'svc1', 'pro1', ?, ?, ?, ?, ?, 'lab:test')`,
      id,
      tenantId,
      startsAt,
      startsAt + HOUR,
      status,
      NOW,
      contactId,
    )
  }

  appt('apt_future_a', DEMO_CLINIC_TENANT_ID, cA.id, NOW + 2 * HOUR)
  appt('apt_past_a', DEMO_CLINIC_TENANT_ID, cA.id, NOW - 2 * HOUR)
  appt('apt_future_b', DEMO_CLINIC_TENANT_ID, cB.id, NOW + 3 * HOUR)
  appt('apt_other_tenant', OTHER_TENANT, cA.id, NOW + 4 * HOUR)

  const proposal = (id: string, contactId: string, convId: string, state: string) => {
    db.run(
      `INSERT INTO appointment_proposals (
        id, tenant_id, lineage_id, version, contact_id, conversation_id, state,
        clinic_location_text, beneficiary_kind, beneficiary_name, service_id, service_name,
        starts_at, ends_at, duration_minutes, timezone, requires_signal, signal_conditions_text,
        created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, '', 'titular', 'A', 'svc1', 'Limpeza',
        ?, ?, 60, 'America/Sao_Paulo', 0, '', ?, ?)`,
      id,
      DEMO_CLINIC_TENANT_ID,
      id,
      contactId,
      convId,
      state,
      NOW + 5 * HOUR,
      NOW + 6 * HOUR,
      NOW,
      NOW,
    )
  }
  proposal('prop_open_a', cA.id, convA.id, 'enviada')
  proposal('prop_closed_a', cA.id, convA.id, 'confirmada')

  db.run(
    `INSERT INTO schedule_holds (
      id, tenant_id, conversation_id, contact_id, service_id, professional_id,
      duration_minutes, window_starts_at, window_ends_at, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'svc1', 'pro1', 60, ?, ?, 'active', 'lab:test', ?, ?)`,
    'hold_a',
    DEMO_CLINIC_TENANT_ID,
    convA.id,
    cA.id,
    NOW + HOUR,
    NOW + 4 * HOUR,
    NOW,
    NOW,
  )

  return { db, clock, close, caller, cA, cB }
}

describe('lab_reset — agenda demo', () => {
  it('dryRun lista contagens sem alterar dados', () => {
    const s = seedAgenda()
    try {
      const before = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND status = 'confirmed'`,
        DEMO_CLINIC_TENANT_ID,
      )!.n
      const out = labResetAgenda(s.db, s.caller, s.clock, { dryRun: true })
      expect(out.dryRun).toBe(true)
      expect(out.counts).toEqual({ appointments: 2, proposals: 1, holds: 1, total: 4 })
      expect(out.items.map((i) => i.id).sort()).toEqual(
        ['apt_future_a', 'apt_future_b', 'hold_a', 'prop_open_a'].sort(),
      )
      const after = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND status = 'confirmed'`,
        DEMO_CLINIC_TENANT_ID,
      )!.n
      expect(after).toBe(before)
      expect(s.db.get<{ state: string }>(
        'SELECT state FROM appointment_proposals WHERE id = ?',
        'prop_open_a',
      )!.state).toBe('enviada')
    } finally {
      s.close()
    }
  })

  it('execução cancela só futuros na demo e preserva passado e outro tenant', () => {
    const s = seedAgenda()
    try {
      const out = labResetAgenda(s.db, s.caller, s.clock, { dryRun: false })
      expect(out.applied).toEqual({
        appointmentsCancelled: 2,
        proposalsExpired: 1,
        holdsCancelled: 1,
      })
      expect(s.db.get<{ status: string }>('SELECT status FROM appointments WHERE id = ?', 'apt_future_a')!.status).toBe(
        'cancelled',
      )
      expect(s.db.get<{ status: string }>('SELECT status FROM appointments WHERE id = ?', 'apt_past_a')!.status).toBe(
        'confirmed',
      )
      expect(s.db.get<{ status: string }>('SELECT status FROM appointments WHERE id = ?', 'apt_other_tenant')!.status).toBe(
        'confirmed',
      )
      expect(s.db.get<{ state: string }>('SELECT state FROM appointment_proposals WHERE id = ?', 'prop_open_a')!.state).toBe(
        'expirada',
      )
      expect(s.db.get<{ state: string }>('SELECT state FROM appointment_proposals WHERE id = ?', 'prop_closed_a')!.state).toBe(
        'confirmada',
      )
      expect(s.db.get<{ status: string }>('SELECT status FROM schedule_holds WHERE id = ?', 'hold_a')!.status).toBe(
        'cancelled',
      )
    } finally {
      s.close()
    }
  })

  it('filtro waId restringe à cliente do número lab', () => {
    const s = seedAgenda()
    try {
      const out = labResetAgenda(s.db, s.caller, s.clock, { dryRun: false, waId: WA_A })
      expect(out.waIdFilter).toBe(WA_A)
      expect(out.applied).toEqual({
        appointmentsCancelled: 1,
        proposalsExpired: 1,
        holdsCancelled: 1,
      })
      expect(s.db.get<{ status: string }>('SELECT status FROM appointments WHERE id = ?', 'apt_future_b')!.status).toBe(
        'confirmed',
      )
    } finally {
      s.close()
    }
  })
})

describe('lab_reset — guardas', () => {
  it('recusa production, tenant não-demo e Clínica Teste Paulo', () => {
    expect(() => assertLabResetAllowed({ ENVIRONMENT: 'production' }, DEMO_CLINIC_TENANT_ID)).toThrow(
      LabResetGuardError,
    )
    expect(() => assertLabResetAllowed({ ENVIRONMENT: 'staging' }, 'tenant_unknown_not_demo')).toThrow(LabResetGuardError)
    expect(() =>
      assertLabResetAllowed({ ENVIRONMENT: 'staging' }, 'tenant_b40dc579540c30130840b9ac'),
    ).toThrow(/Clínica Teste Paulo/)
    expect(() => assertLabResetAllowed(undefined, DEMO_CLINIC_TENANT_ID)).toThrow(LabResetGuardError)
  })

  it('callLabTool recusa production e waId inválido antes do DO', async () => {
    const labReset = vi.fn()
    const envProd = {
      ENVIRONMENT: 'production',
      LAB_ENABLED: 'true',
      OAUTH_KV: {},
      CLINIC: { idFromName: (n: string) => n, get: () => ({ labReset }) },
    } as unknown as WorkerBindings
    const prod = await callLabTool('lab_reset', {}, envProd)
    expect(prod.isError).toBe(true)
    expect(labReset).not.toHaveBeenCalled()

    const env = {
      ENVIRONMENT: 'staging',
      LAB_ENABLED: 'true',
      OAUTH_KV: {},
      CLINIC: { idFromName: (n: string) => n, get: () => ({ labReset }) },
    } as unknown as WorkerBindings
    const badWa = await callLabTool('lab_reset', { waId: '5511999990000' }, env)
    expect(badWa.isError).toBe(true)
    expect(labReset).not.toHaveBeenCalled()
  })
})