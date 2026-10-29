/**
 * S7 (#178): limites de abuso. Valores Confirmados (Paulo, 29/10/2026); desligado por padrão.
 * Dados fictícios. Sem UI de clínica — só env `ABUSE_LIMITS` / `ABUSE_LIMIT_*`.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { AI_AUTOBOOK_ACTOR } from '../constants'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { upsertResourceOp, upsertServiceOp } from '../config'
import { createProposal } from '../proposals/proposals'
import { bootClinicDb } from '../test-db'
import {
  DEFAULT_ABUSE_LIMITS,
  abuseLimitsFromEnv,
  checkAutomationQuota,
  countPendingProposalsForContact,
  countProposalsCreated,
  type AbuseLimits,
} from './abuse-limits'
import { rpcDepsFromEnv, toAiAssistDeps } from './deps'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'

const NOW = Date.UTC(2026, 9, 28, 18, 51)
const HOUR = 3_600_000

function seed(tenantId = 'clinic-demo-a') {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contacts: Record<string, { contactId: string; conversationId: string }> = {}
  const addContact = (key: string, waId: string) => {
    const contact = upsertContact(db, { tenantId, waId, displayName: `Contato ${key}` }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    contacts[key] = { contactId: contact.id, conversationId: cnv.id }
    return contacts[key]!
  }
  const inbound = (key: string, body: string) => {
    const c = contacts[key]!
    const m = insertMessage(
      db,
      { tenantId, conversationId: c.conversationId, direction: 'inbound', body, deliveryState: 'received', createdAt: clock.nowMs() },
      clock,
    )
    enqueueAutoDraft(db, tenantId, { conversationId: c.conversationId, messageId: m.id }, clock)
  }
  const drain = async (limits?: AbuseLimits) => {
    clock.advance(7_000)
    return runDueAutoDrafts(db, caller, clock, {
      mode: 'synthetic',
      adapter: new SimulatedAiAdapter(),
      ...(limits ? { abuseLimits: limits } : {}),
    })
  }
  const audits = () =>
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM operational_audit WHERE action = 'abuse.limit_reached'`)!.n
  return { ...boot, clock, caller, tenantId, addContact, inbound, drain, audits }
}

const on = (over: Partial<AbuseLimits> = {}): AbuseLimits => ({ ...DEFAULT_ABUSE_LIMITS, enabled: true, ...over })

describe('S7: configuração', () => {
  it('desligado por padrão; só «on» liga', () => {
    expect(DEFAULT_ABUSE_LIMITS.enabled).toBe(false)
    expect(abuseLimitsFromEnv({}).enabled).toBe(false)
    expect(abuseLimitsFromEnv({ ABUSE_LIMITS: 'true' }).enabled).toBe(false)
    expect(abuseLimitsFromEnv({ ABUSE_LIMITS: ' ON ' }).enabled).toBe(true)
    expect(rpcDepsFromEnv({}).abuseLimits?.enabled).toBe(false)
    expect(toAiAssistDeps(rpcDepsFromEnv({ ABUSE_LIMITS: 'on' })).abuseLimits?.enabled).toBe(true)
  })

  it('padrões Confirmados e sobrescrita por ABUSE_LIMIT_* (inválido → padrão)', () => {
    const l = abuseLimitsFromEnv({
      ABUSE_LIMITS: 'on',
      ABUSE_LIMIT_AUTO_DRAFTS_PER_CONTACT: '5',
      ABUSE_LIMIT_WINDOW_HOURS: '12',
      ABUSE_LIMIT_AI_BOOKINGS_PER_CLINIC: 'muitos',
      ABUSE_LIMIT_PENDING_PIX_PER_CONTACT: '-1',
    })
    expect(l.autoDraftsPerContact).toBe(5)
    expect(l.windowMs).toBe(12 * HOUR)
    expect(l.aiBookingsPerClinic).toBe(DEFAULT_ABUSE_LIMITS.aiBookingsPerClinic)
    expect(l.pendingPixPerContact).toBe(DEFAULT_ABUSE_LIMITS.pendingPixPerContact)
    expect(DEFAULT_ABUSE_LIMITS).toMatchObject({
      windowMs: 24 * HOUR,
      autoDraftsPerContact: 20,
      autoDraftsPerClinic: 300,
      aiBookingsPerContact: 1,
      aiBookingsPerClinic: 20,
      futureAppointmentsPerContact: 3,
      pendingPixPerContact: 2,
      pendingProposalsPerContact: 1,
      proposalsPerContact: 5,
      proposalsPerClinic: 100,
    })
  })
})

describe('S7: rascunhos automáticos por contato', () => {
  it('inundação de mensagens: para no limite, avisa uma vez, não afeta outro contato', async () => {
    const s = seed()
    try {
      s.addContact('a', '5511900000101')
      s.addContact('b', '5511900000102')
      const limits = on({ autoDraftsPerContact: 2 })
      const statuses: string[] = []
      for (let i = 0; i < 5; i++) {
        s.inbound('a', `mensagem ${i}`)
        const out = await s.drain(limits)
        statuses.push(out[0]!.status === 'skipped' ? out[0]!.reason! : out[0]!.status)
      }
      expect(statuses.slice(0, 2)).toEqual(['ready', 'ready'])
      expect(statuses.slice(2)).toEqual(Array(3).fill('abuse_limit:autoDraftsPerContact'))
      expect(s.audits()).toBe(1)
      // Outro contato da mesma clínica segue normal.
      s.inbound('b', 'Oi, tem horário?')
      expect((await s.drain(limits))[0]!.status).toBe('ready')
      // Contato não é bloqueado.
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM contacts WHERE blocked_at IS NOT NULL`)!.n).toBe(0)
    } finally {
      s.close()
    }
  })

  it('janela rolante: depois de 24 h volta a gerar', async () => {
    const s = seed()
    try {
      s.addContact('a', '5511900000103')
      const limits = on({ autoDraftsPerContact: 1 })
      s.inbound('a', 'oi')
      expect((await s.drain(limits))[0]!.status).toBe('ready')
      s.inbound('a', 'oi de novo')
      expect((await s.drain(limits))[0]!.status).toBe('skipped')
      s.clock.advance(24 * HOUR)
      s.inbound('a', 'oi amanhã')
      expect((await s.drain(limits))[0]!.status).toBe('ready')
    } finally {
      s.close()
    }
  })

  it('desligado → sem limite (comportamento atual preservado)', async () => {
    const s = seed()
    try {
      s.addContact('a', '5511900000104')
      for (let i = 0; i < 4; i++) {
        s.inbound('a', `m${i}`)
        expect((await s.drain(on({ enabled: false, autoDraftsPerContact: 1 })))[0]!.status).toBe('ready')
      }
      expect(s.audits()).toBe(0)
    } finally {
      s.close()
    }
  })

  it('várias conversas do mesmo contato em paralelo contam juntas (jobs em geração)', async () => {
    const s = seed()
    try {
      const a = s.addContact('a', '5511900000105')
      const cnv2 = createConversation(s.db, { tenantId: s.tenantId, contactId: a.contactId, status: 'open' }, s.clock)
      s.inbound('a', 'primeira')
      const m = insertMessage(
        s.db,
        { tenantId: s.tenantId, conversationId: cnv2.id, direction: 'inbound', body: 'segunda', deliveryState: 'received', createdAt: s.clock.nowMs() },
        s.clock,
      )
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: cnv2.id, messageId: m.id }, s.clock)
      const out = await s.drain(on({ autoDraftsPerContact: 1 }))
      expect(out.map((o) => o.status).sort()).toEqual(['ready', 'skipped'])
    } finally {
      s.close()
    }
  })
})

describe('S7: marcações automáticas e Pix (quota consultada no backend)', () => {
  function insertAppt(s: ReturnType<typeof seed>, id: string, contactId: string, opts: { ai?: boolean; startsAt?: number; createdAt?: number } = {}) {
    s.db.run(
      `INSERT INTO appointments (id, tenant_id, service_id, professional_id, starts_at, ends_at, status, created_at, contact_id, confirmed_by)
       VALUES (?, ?, 'svc_fake', 'pro_fake', ?, ?, 'confirmed', ?, ?, ?)`,
      id,
      s.tenantId,
      opts.startsAt ?? NOW + 48 * HOUR,
      (opts.startsAt ?? NOW + 48 * HOUR) + HOUR,
      opts.createdAt ?? NOW,
      contactId,
      opts.ai ? AI_AUTOBOOK_ACTOR : 'user_synth_owner_a',
    )
  }

  it('1 marcação pela IA por contato em 24 h; outro contato não é afetado', () => {
    const s = seed()
    try {
      const a = s.addContact('a', '5511900000201')
      const b = s.addContact('b', '5511900000202')
      const l = on()
      const q = (contactId: string) => checkAutomationQuota(s.db, l, { tenantId: s.tenantId, contactId, effect: 'ai_booking' }, s.clock)
      expect(q(a.contactId).allowed).toBe(true)
      insertAppt(s, 'apt_ai_1', a.contactId, { ai: true })
      expect(q(a.contactId)).toMatchObject({ allowed: false, limit: 'aiBookingsPerContact', scope: 'contact' })
      expect(q(b.contactId).allowed).toBe(true)
    } finally {
      s.close()
    }
  })

  it('20 marcações pela IA por clínica em 24 h', () => {
    const s = seed()
    try {
      const l = on()
      for (let i = 0; i < 20; i++) {
        const c = s.addContact(`c${i}`, `55119000003${String(i).padStart(2, '0')}`)
        insertAppt(s, `apt_ai_c${i}`, c.contactId, { ai: true })
      }
      const fresh = s.addContact('novo', '5511900000399')
      expect(checkAutomationQuota(s.db, l, { tenantId: s.tenantId, contactId: fresh.contactId, effect: 'ai_booking' }, s.clock)).toMatchObject({
        allowed: false,
        limit: 'aiBookingsPerClinic',
        scope: 'clinic',
      })
    } finally {
      s.close()
    }
  })

  it('3 compromissos futuros por contato (qualquer origem) bloqueiam nova marcação automática', () => {
    const s = seed()
    try {
      const a = s.addContact('a', '5511900000401')
      const l = on()
      for (let i = 0; i < 3; i++) insertAppt(s, `apt_h_${i}`, a.contactId, { startsAt: NOW + (i + 1) * 24 * HOUR })
      insertAppt(s, 'apt_past', a.contactId, { startsAt: NOW - 24 * HOUR })
      expect(checkAutomationQuota(s.db, l, { tenantId: s.tenantId, contactId: a.contactId, effect: 'ai_booking' }, s.clock)).toMatchObject({
        allowed: false,
        limit: 'futureAppointmentsPerContact',
      })
    } finally {
      s.close()
    }
  })

  it('2 cobranças Pix pendentes por contato', () => {
    const s = seed()
    try {
      const a = s.addContact('a', '5511900000501')
      const l = on()
      const add = (id: string, status: string) =>
        s.db.run(
          `INSERT INTO pix_charges (id, tenant_id, account_id, provider, external_reference, amount_cents, status, created_at, updated_at, contact_id)
           VALUES (?, ?, 'acc_fake', 'synthetic', ?, 5000, ?, ?, ?, ?)`,
          id, s.tenantId, `ref_${id}`, status, NOW, NOW, a.contactId,
        )
      add('pix_1', 'awaiting_payment')
      add('pix_paid', 'paid')
      expect(checkAutomationQuota(s.db, l, { tenantId: s.tenantId, contactId: a.contactId, effect: 'pix_charge' }, s.clock).allowed).toBe(true)
      add('pix_2', 'awaiting_payment')
      expect(checkAutomationQuota(s.db, l, { tenantId: s.tenantId, contactId: a.contactId, effect: 'pix_charge' }, s.clock)).toMatchObject({
        allowed: false,
        limit: 'pendingPixPerContact',
      })
    } finally {
      s.close()
    }
  })

  it('isolamento entre clínicas: quotas contam só o tenant do DO', () => {
    const s = seed('clinic-demo-a')
    try {
      const a = s.addContact('a', '5511900000601')
      insertAppt(s, 'apt_ai_x', a.contactId, { ai: true })
      expect(
        checkAutomationQuota(s.db, on(), { tenantId: 'clinic-demo-b', contactId: a.contactId, effect: 'ai_booking' }, s.clock).allowed,
      ).toBe(true)
    } finally {
      s.close()
    }
  })
})

describe('S7: quotas de propostas (appointment_proposals, S3)', () => {
  function seedWithService() {
    const s = seed()
    const pro = upsertResourceOp(
      s.db,
      s.caller,
      { kind: 'professional', name: 'Dra. Paula Reis' },
      s.clock,
    )
    const svc = upsertServiceOp(
      s.db,
      s.caller,
      {
        name: 'Limpeza de pele fictícia',
        durationMinutes: 60,
        bufferMinutes: 15,
        priceCents: 15_000,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      s.clock,
    )
    return { ...s, pro, svc }
  }

  it('1 proposta pendente por contato; criação conta na janela', () => {
    const s = seedWithService()
    try {
      const a = s.addContact('a', '5511900000701')
      const b = s.addContact('b', '5511900000702')
      const startsAt = NOW + 48 * HOUR
      createProposal(
        s.db,
        s.tenantId,
        {
          contactId: a.contactId,
          conversationId: a.conversationId,
          serviceId: s.svc.id,
          startsAt,
        },
        s.clock,
      )
      expect(countPendingProposalsForContact(s.db, s.tenantId, a.contactId)).toBe(1)
      expect(countProposalsCreated(s.db, s.tenantId, NOW - HOUR, a.contactId)).toBe(1)
      const l = on()
      expect(
        checkAutomationQuota(s.db, l, { tenantId: s.tenantId, contactId: a.contactId, effect: 'proposal' }, s.clock),
      ).toMatchObject({ allowed: false, limit: 'pendingProposalsPerContact', scope: 'contact' })
      expect(
        checkAutomationQuota(s.db, l, { tenantId: s.tenantId, contactId: b.contactId, effect: 'proposal' }, s.clock).allowed,
      ).toBe(true)
    } finally {
      s.close()
    }
  })

  it('5 propostas por contato / 100 por clínica em 24 h (quando habilitado)', () => {
    const s = seedWithService()
    try {
      const a = s.addContact('a', '5511900000801')
      const since = NOW - HOUR
      for (let i = 0; i < 5; i++) {
        s.db.run(
          `INSERT INTO appointment_proposals (
             id, tenant_id, lineage_id, version, contact_id, conversation_id, state,
             clinic_location_text, beneficiary_kind, beneficiary_name, service_id, service_name,
             starts_at, ends_at, duration_minutes, timezone, requires_signal, signal_conditions_text,
             created_at, updated_at
           ) VALUES (?, ?, ?, 1, ?, ?, 'expirada', '', 'titular', 'Contato a', ?, 'Limpeza',
             ?, ?, 60, 'America/Sao_Paulo', 0, '', ?, ?)`,
          `aprop_c_${i}`,
          s.tenantId,
          `aprop_c_${i}`,
          a.contactId,
          a.conversationId,
          s.svc.id,
          NOW + (i + 1) * HOUR,
          NOW + (i + 2) * HOUR,
          NOW - 60_000 + i,
          NOW - 60_000 + i,
        )
      }
      expect(countProposalsCreated(s.db, s.tenantId, since, a.contactId)).toBe(5)
      expect(
        checkAutomationQuota(
          s.db,
          on({ pendingProposalsPerContact: 99 }),
          { tenantId: s.tenantId, contactId: a.contactId, effect: 'proposal' },
          s.clock,
        ),
      ).toMatchObject({ allowed: false, limit: 'proposalsPerContact', scope: 'contact' })

      for (let i = 0; i < 100; i++) {
        const c = s.addContact(`clinic_${i}`, `55119000009${String(i).padStart(2, '0')}`)
        s.db.run(
          `INSERT INTO appointment_proposals (
             id, tenant_id, lineage_id, version, contact_id, conversation_id, state,
             clinic_location_text, beneficiary_kind, beneficiary_name, service_id, service_name,
             starts_at, ends_at, duration_minutes, timezone, requires_signal, signal_conditions_text,
             created_at, updated_at
           ) VALUES (?, ?, ?, 1, ?, ?, 'expirada', '', 'titular', 'X', ?, 'Limpeza',
             ?, ?, 60, 'America/Sao_Paulo', 0, '', ?, ?)`,
          `aprop_clinic_${i}`,
          s.tenantId,
          `aprop_clinic_${i}`,
          c.contactId,
          c.conversationId,
          s.svc.id,
          NOW + HOUR,
          NOW + 2 * HOUR,
          NOW - 30_000,
          NOW - 30_000,
        )
      }
      const fresh = s.addContact('fresh', '5511900000999')
      expect(countProposalsCreated(s.db, s.tenantId, since)).toBeGreaterThanOrEqual(100)
      expect(
        checkAutomationQuota(
          s.db,
          on({ pendingProposalsPerContact: 99, proposalsPerContact: 99 }),
          { tenantId: s.tenantId, contactId: fresh.contactId, effect: 'proposal' },
          s.clock,
        ),
      ).toMatchObject({ allowed: false, limit: 'proposalsPerClinic', scope: 'clinic' })
    } finally {
      s.close()
    }
  })

  it('desligado → criar proposta não aplica quota', () => {
    const s = seedWithService()
    try {
      const a = s.addContact('a', '5511900001001')
      createProposal(
        s.db,
        s.tenantId,
        {
          contactId: a.contactId,
          conversationId: a.conversationId,
          serviceId: s.svc.id,
          startsAt: NOW + 48 * HOUR,
        },
        s.clock,
        { abuseLimits: on({ enabled: false, pendingProposalsPerContact: 0 }) },
      )
      expect(
        checkAutomationQuota(
          s.db,
          on({ enabled: false }),
          { tenantId: s.tenantId, contactId: a.contactId, effect: 'proposal' },
          s.clock,
        ).allowed,
      ).toBe(true)
    } finally {
      s.close()
    }
  })
})
