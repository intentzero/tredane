import { describe, expect, it, vi } from 'vitest'
import { createControllableClock } from '../db/clock'
import { workerCaller } from '../clinic'
import {
  DEMO_CLINIC_TENANT_ID,
  STAGING_TESTE_PAULO_TENANT_ID,
} from '../clinic/demo/ids'
import { upsertContact } from '../clinic/contacts'
import { createConversation } from '../clinic/inbox/conversations'
import { bootClinicDb } from '../clinic/test-db'
import { labResetAgenda } from './reset'
import {
  assertLabResetAllowed,
  LabResetGuardError,
  resolveLabResetTenantId,
} from './reset-guards'
import {
  PAULO_PROTECTED_CONTACT_IDS,
  PAULO_PROTECTED_CONVERSATION_IDS,
  resolveLabResetProtection,
} from './reset-protected'
import { callLabTool } from './routes'
import type { WorkerBindings } from '../worker/bindings'

const NOW = Date.UTC(2026, 10, 16, 15, 0)
const HOUR = 3_600_000
const WA_SYNTH_A = '550000000201'
const WA_SYNTH_B = '550000000202'
const WA_SYNTH_C = '550000000401'
const WA_PROTECTED_ENV = '550000000301'
const CONTACT_CONV_ONLY = 'ctc_synth_conv_only'

function seedContactGraph(
  db: ReturnType<typeof bootClinicDb>['db'],
  clock: ReturnType<typeof createControllableClock>,
  tenantId: string,
  contactId: string,
  waId: string,
  convId?: string,
) {
  upsertContact(db, { tenantId, waId, displayName: 'Synth', id: contactId }, clock)
  const cid = convId ?? `cnv_synth_${contactId.slice(-6)}`
  createConversation(db, { tenantId, contactId, status: 'open', id: cid }, clock)
  db.run(
    `INSERT INTO appointments (
      id, tenant_id, service_id, professional_id, starts_at, ends_at, status,
      created_at, contact_id, confirmed_by
    ) VALUES (?, ?, 'svc1', 'pro1', ?, ?, 'confirmed', ?, ?, 'lab:test')`,
    `apt_${contactId}`,
    tenantId,
    NOW + 2 * HOUR,
    NOW + 3 * HOUR,
    NOW,
    contactId,
  )
  db.run(
    `INSERT INTO appointment_proposals (
      id, tenant_id, lineage_id, version, contact_id, conversation_id, state,
      clinic_location_text, beneficiary_kind, beneficiary_name, service_id, service_name,
      starts_at, ends_at, duration_minutes, timezone, requires_signal, signal_conditions_text,
      created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, 'enviada', '', 'titular', 'Synth', 'svc1', 'X',
      ?, ?, 60, 'America/Sao_Paulo', 0, '', ?, ?)`,
    `prop_${contactId}`,
    tenantId,
    `prop_${contactId}`,
    contactId,
    cid,
    NOW + 4 * HOUR,
    NOW + 5 * HOUR,
    NOW,
    NOW,
  )
  db.run(
    `INSERT INTO messages (id, tenant_id, conversation_id, direction, body, delivery_state, created_at)
     VALUES (?, ?, ?, 'inbound', 'oi', 'received', ?)`,
    `msg_${contactId}`,
    tenantId,
    cid,
    NOW,
  )
  return { contactId, convId: cid }
}

describe('lab_reset — demo hard reset', () => {
  it('dryRun=true por defeito não apaga e regista contagens', () => {
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller(DEMO_CLINIC_TENANT_ID, 'lab:test')
      seedContactGraph(db, clock, DEMO_CLINIC_TENANT_ID, 'ctc_demo_a', WA_SYNTH_A)
      const before = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`,
        DEMO_CLINIC_TENANT_ID,
      )!.n
      const out = labResetAgenda(db, caller, clock, { protectionEnv: {} })
      expect(out.dryRun).toBe(true)
      expect(out.deleted.appointmentsFuture).toBeGreaterThan(0)
      const after = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`,
        DEMO_CLINIC_TENANT_ID,
      )!.n
      expect(after).toBe(before)
      const audit = db.get<{ detail: string }>(
        `SELECT detail_json AS detail FROM operational_audit WHERE tenant_id = ? AND action = 'lab.agenda_hard_reset' ORDER BY occurred_at DESC LIMIT 1`,
        DEMO_CLINIC_TENANT_ID,
      )
      expect(audit?.detail).toContain('dryRun')
    } finally {
      close()
    }
  })

  it('apaga todas as categorias no tenant demo', () => {
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller(DEMO_CLINIC_TENANT_ID, 'lab:test')
      seedContactGraph(db, clock, DEMO_CLINIC_TENANT_ID, 'ctc_demo_b', WA_SYNTH_B)
      const out = labResetAgenda(db, caller, clock, { dryRun: false, protectionEnv: {} })
      expect(out.dryRun).toBe(false)
      expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM contacts WHERE tenant_id = ?`, DEMO_CLINIC_TENANT_ID)!.n).toBe(
        0,
      )
      expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`, DEMO_CLINIC_TENANT_ID)!.n).toBe(
        0,
      )
      expect(
        db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointment_proposals WHERE tenant_id = ?`, DEMO_CLINIC_TENANT_ID)!
          .n,
      ).toBe(0)
    } finally {
      close()
    }
  })
})

describe('lab_reset — Teste Paulo proteções', () => {
  it('mantém contacto protegido por id e limpa sintético', () => {
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    try {
      const tenantId = STAGING_TESTE_PAULO_TENANT_ID
      const caller = workerCaller(tenantId, 'lab:test')
      const protectedId = PAULO_PROTECTED_CONTACT_IDS[0]!
      const protectedConv = PAULO_PROTECTED_CONVERSATION_IDS[0]!
      seedContactGraph(db, clock, tenantId, protectedId, WA_SYNTH_A, protectedConv)
      seedContactGraph(db, clock, tenantId, 'ctc_synth_clear', WA_SYNTH_B)
      const protectedRow = db.get<Record<string, unknown>>(
        `SELECT * FROM appointments WHERE id = ?`,
        `apt_${protectedId}`,
      )!
      const snap = JSON.stringify(protectedRow)
      labResetAgenda(db, caller, clock, { dryRun: false, protectionEnv: {} })
      expect(JSON.stringify(db.get(`SELECT * FROM appointments WHERE id = ?`, `apt_${protectedId}`))).toBe(snap)
      expect(db.get(`SELECT id FROM contacts WHERE id = ?`, protectedId)).toBeTruthy()
      expect(db.get(`SELECT id FROM appointments WHERE id = ?`, 'apt_ctc_synth_clear')).toBeFalsy()
    } finally {
      close()
    }
  })

  it('protege só pela conversa cnv_… sem contact id nem waId na lista', () => {
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    try {
      const tenantId = STAGING_TESTE_PAULO_TENANT_ID
      const caller = workerCaller(tenantId, 'lab:test')
      const protectedConv = PAULO_PROTECTED_CONVERSATION_IDS[0]!
      expect(PAULO_PROTECTED_CONTACT_IDS).not.toContain(CONTACT_CONV_ONLY)
      seedContactGraph(db, clock, tenantId, CONTACT_CONV_ONLY, WA_SYNTH_C, protectedConv)
      seedContactGraph(db, clock, tenantId, 'ctc_synth_clear_conv', WA_SYNTH_B)
      const snapshots = {
        contact: JSON.stringify(db.get(`SELECT * FROM contacts WHERE id = ?`, CONTACT_CONV_ONLY)),
        conv: JSON.stringify(db.get(`SELECT * FROM conversations WHERE id = ?`, protectedConv)),
        appt: JSON.stringify(db.get(`SELECT * FROM appointments WHERE id = ?`, `apt_${CONTACT_CONV_ONLY}`)),
        prop: JSON.stringify(db.get(`SELECT * FROM appointment_proposals WHERE id = ?`, `prop_${CONTACT_CONV_ONLY}`)),
        msg: JSON.stringify(db.get(`SELECT * FROM messages WHERE id = ?`, `msg_${CONTACT_CONV_ONLY}`)),
      }
      labResetAgenda(db, caller, clock, { dryRun: false, protectionEnv: {} })
      expect(JSON.stringify(db.get(`SELECT * FROM contacts WHERE id = ?`, CONTACT_CONV_ONLY))).toBe(snapshots.contact)
      expect(JSON.stringify(db.get(`SELECT * FROM conversations WHERE id = ?`, protectedConv))).toBe(snapshots.conv)
      expect(JSON.stringify(db.get(`SELECT * FROM appointments WHERE id = ?`, `apt_${CONTACT_CONV_ONLY}`))).toBe(
        snapshots.appt,
      )
      expect(JSON.stringify(db.get(`SELECT * FROM appointment_proposals WHERE id = ?`, `prop_${CONTACT_CONV_ONLY}`))).toBe(
        snapshots.prop,
      )
      expect(JSON.stringify(db.get(`SELECT * FROM messages WHERE id = ?`, `msg_${CONTACT_CONV_ONLY}`))).toBe(
        snapshots.msg,
      )
      expect(db.get(`SELECT id FROM contacts WHERE id = ?`, 'ctc_synth_clear_conv')).toBeFalsy()
    } finally {
      close()
    }
  })

  it('protege por waId em LAB_RESET_PROTECTED_WAIDS', () => {
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    try {
      const tenantId = STAGING_TESTE_PAULO_TENANT_ID
      const caller = workerCaller(tenantId, 'lab:test')
      const protectedWaContact = 'ctc_env_wa_prot'
      upsertContact(db, { tenantId, waId: WA_PROTECTED_ENV, displayName: 'P', id: protectedWaContact }, clock)
      const convProt = `cnv_wa_${protectedWaContact.slice(-6)}`
      createConversation(db, { tenantId, contactId: protectedWaContact, status: 'open', id: convProt }, clock)
      db.run(
        `INSERT INTO appointments (
          id, tenant_id, service_id, professional_id, starts_at, ends_at, status,
          created_at, contact_id, confirmed_by
        ) VALUES (?, ?, 'svc1', 'pro1', ?, ?, 'confirmed', ?, ?, 'lab:test')`,
        `apt_${protectedWaContact}`,
        tenantId,
        NOW + 2 * HOUR,
        NOW + 3 * HOUR,
        NOW,
        protectedWaContact,
      )
      seedContactGraph(db, clock, tenantId, 'ctc_clear_env', WA_SYNTH_B)
      labResetAgenda(db, caller, clock, {
        dryRun: false,
        protectionEnv: { LAB_RESET_PROTECTED_WAIDS: WA_PROTECTED_ENV },
      })
      expect(db.get(`SELECT id FROM contacts WHERE id = ?`, protectedWaContact)).toBeTruthy()
      expect(db.get(`SELECT id FROM contacts WHERE id = ?`, 'ctc_clear_env')).toBeFalsy()
    } finally {
      close()
    }
  })

  it('recusa waId que aponta para protegido', () => {
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller(STAGING_TESTE_PAULO_TENANT_ID, 'lab:test')
      seedContactGraph(
        db,
        clock,
        STAGING_TESTE_PAULO_TENANT_ID,
        PAULO_PROTECTED_CONTACT_IDS[0]!,
        WA_SYNTH_A,
        PAULO_PROTECTED_CONVERSATION_IDS[0],
      )
      expect(() =>
        labResetAgenda(db, caller, clock, {
          waId: WA_SYNTH_A,
          protectionEnv: {},
        }),
      ).toThrow(/protegido/)
    } finally {
      close()
    }
  })

  it('fail-closed se LAB_RESET_PROTECTED_WAIDS é inválido', () => {
    expect(
      resolveLabResetProtection(STAGING_TESTE_PAULO_TENANT_ID, { LAB_RESET_PROTECTED_WAIDS: 'not-a-wa-id' }),
    ).toBeNull()
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller(STAGING_TESTE_PAULO_TENANT_ID, 'lab:test')
      expect(() =>
        labResetAgenda(db, caller, clock, {
          protectionEnv: { LAB_RESET_PROTECTED_WAIDS: '5511999990000' },
        }),
      ).toThrow(/fail-closed|proteção/)
    } finally {
      close()
    }
  })
})

describe('lab_reset — guardas de rota', () => {
  it('recusa tenant não autorizado e aceita demo e Teste Paulo', () => {
    expect(() => assertLabResetAllowed({ ENVIRONMENT: 'staging' }, 'tenant_other')).toThrow(LabResetGuardError)
    expect(resolveLabResetTenantId(undefined)).toBe(DEMO_CLINIC_TENANT_ID)
    expect(resolveLabResetTenantId(STAGING_TESTE_PAULO_TENANT_ID)).toBe(STAGING_TESTE_PAULO_TENANT_ID)
    expect(() => assertLabResetAllowed({ ENVIRONMENT: 'production' }, DEMO_CLINIC_TENANT_ID)).toThrow(
      LabResetGuardError,
    )
  })

  it('production 404 / callLabTool recusa antes do DO', async () => {
    const labReset = vi.fn()
    const prod = await callLabTool(
      'lab_reset',
      {},
      {
        ENVIRONMENT: 'production',
        LAB_ENABLED: 'true',
        OAUTH_KV: {},
        CLINIC: { idFromName: (n: string) => n, get: () => ({ labReset }) },
      } as unknown as WorkerBindings,
    )
    expect(prod.isError).toBe(true)
    expect(labReset).not.toHaveBeenCalled()
  })
})