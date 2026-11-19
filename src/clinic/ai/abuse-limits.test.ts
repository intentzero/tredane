/**
 * S7 (#178): limites de abuso. Valores Confirmados (Paulo, 29/10/2026); desligado por padrão.
 * Dados fictícios. Enable efetivo = clínica (UI owner); env = tetos/bootstrap.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { updateClinicAbuseLimits } from '../config/abuse-limits-settings'
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
  DEFAULT_ABUSE_LIMIT_NUMBERS,
  abuseLimitsFromEnv,
  checkAutomationQuota,
  countPendingProposalsForContact,
  countProposalsCreated,
  resolveAbuseLimits,
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
  it('desligado por padrão; env «on» só marca platform.enabled legado', () => {
    expect(DEFAULT_ABUSE_LIMITS.enabled).toBe(false)
    expect(abuseLimitsFromEnv({}).enabled).toBe(false)
    expect(abuseLimitsFromEnv({ ABUSE_LIMITS: 'true' }).enabled).toBe(false)
    expect(abuseLimitsFromEnv({ ABUSE_LIMITS: ' ON ' }).enabled).toBe(true)
    expect(rpcDepsFromEnv({}).abuseLimits?.enabled).toBe(false)
    expect(toAiAssistDeps(rpcDepsFromEnv({ ABUSE_LIMITS: 'on' })).abuseLimits?.enabled).toBe(true)
  })

  it('resolveAbuseLimits: enable da clínica; env on não liga sozinho; env aperta teto', () => {
    const env = {
      ABUSE_LIMITS: 'on',
      ABUSE_LIMIT_AUTO_DRAFTS_PER_CONTACT: '10',
    }
    const platform = abuseLimitsFromEnv(env)
    expect(
      resolveAbuseLimits(
        platform,
        { enabled: false, ...DEFAULT_ABUSE_LIMIT_NUMBERS, autoDraftsPerContact: 10 },
        env,
      ).enabled,
    ).toBe(false)
    const onClinic = resolveAbuseLimits(
      platform,
      { enabled: true, ...DEFAULT_ABUSE_LIMIT_NUMBERS, autoDraftsPerContact: 99 },
      env,
    )
    expect(onClinic.enabled).toBe(true)
    expect(onClinic.autoDraftsPerContact).toBe(10)
    // Sem env de teto, a clínica pode subir até o hard cap.
    const raised = resolveAbuseLimits(
      abuseLimitsFromEnv({}),
      { enabled: true, ...DEFAULT_ABUSE_LIMIT_NUMBERS, autoDraftsPerContact: 50 },
      {},
    )
    expect(raised.autoDraftsPerContact).toBe(50)
  })

  it('padrões Confirmados e sobrescrita por ABUSE_LIMIT_* (inválido → padrão)', () => {
    const l = abuseLimitsFromEnv({
      ABUSE_LIMITS: 'on',
      ABUSE_LIMIT_AUTO_DRAFTS_PER_CONTACT: '5',
      ABUSE_LIMIT_WINDOW_HOURS: '12',
      ABUSE_LIMIT_PENDING_PIX_PER_CONTACT: '-1',
    })
    expect(l.autoDraftsPerContact).toBe(5)
    expect(l.windowMs).toBe(12 * HOUR)
    expect(l.pendingPixPerContact).toBe(DEFAULT_ABUSE_LIMITS.pendingPixPerContact)
    expect(DEFAULT_ABUSE_LIMITS).toMatchObject({
      windowMs: 24 * HOUR,
      autoDraftsPerContact: 20,
      autoDraftsPerClinic: 300,
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
        s.inbound('a', `vocês aceitam cartão? (${i})`)
        const out = await s.drain(limits)
        statuses.push(out[0]!.status === 'skipped' ? out[0]!.reason! : out[0]!.status)
      }
      expect(statuses.slice(0, 2)).toEqual(['ready', 'ready'])
      expect(statuses.slice(2)).toEqual(Array(3).fill('abuse_limit:autoDraftsPerContact'))
      expect(s.audits()).toBe(1)
      // Outro contato da mesma clínica segue normal.
      s.inbound('b', 'Vocês têm estacionamento?')
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
      s.inbound('a', 'vocês aceitam cartão?')
      expect((await s.drain(limits))[0]!.status).toBe('ready')
      s.inbound('a', 'vocês têm estacionamento?')
      expect((await s.drain(limits))[0]!.status).toBe('skipped')
      s.clock.advance(24 * HOUR)
      s.inbound('a', 'vocês atendem aos domingos?')
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
        s.inbound('a', `vocês aceitam cartão? (${i})`)
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

  it('agenda online (DEC-214): 3 marcações à frente e 2 Pix por pagar travam marcação nova, não remarcação', () => {
    const s = seed()
    try {
      const a = s.addContact('a', '5511900000701')
      const l = on()
      const q = (extra: { requiresSignal?: boolean; isReschedule?: boolean } = {}) =>
        checkAutomationQuota(s.db, l, { tenantId: s.tenantId, contactId: a.contactId, effect: 'proposal', ...extra }, s.clock)
      expect(q().allowed).toBe(true)
      for (let i = 0; i < 3; i++) insertAppt(s, `apt_w_${i}`, a.contactId, { startsAt: NOW + (i + 1) * 24 * HOUR })
      expect(q()).toMatchObject({ allowed: false, limit: 'futureAppointmentsPerContact', scope: 'contact' })
      expect(q({ isReschedule: true }).allowed).toBe(true)

      const b = s.addContact('b', '5511900000702')
      const addPix = (id: string) =>
        s.db.run(
          `INSERT INTO pix_charges (id, tenant_id, account_id, provider, external_reference, amount_cents, status, created_at, updated_at, contact_id)
           VALUES (?, ?, 'acc_fake', 'synthetic', ?, 5000, 'awaiting_payment', ?, ?, ?)`,
          id, s.tenantId, `ref_${id}`, NOW, NOW, b.contactId,
        )
      addPix('pix_w_1')
      addPix('pix_w_2')
      const qb = (extra: { requiresSignal?: boolean; isReschedule?: boolean } = {}) =>
        checkAutomationQuota(s.db, l, { tenantId: s.tenantId, contactId: b.contactId, effect: 'proposal', ...extra }, s.clock)
      expect(qb().allowed).toBe(true) // serviço sem sinal não conta Pix
      expect(qb({ requiresSignal: true })).toMatchObject({ allowed: false, limit: 'pendingPixPerContact' })
      expect(qb({ requiresSignal: true, isReschedule: true }).allowed).toBe(true)
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
        checkAutomationQuota(s.db, on(), { tenantId: 'clinic-demo-b', contactId: a.contactId, effect: 'proposal' }, s.clock).allowed,
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

describe('S7: UI clínica — persistência e pausa', () => {
  it('owner liga limites na clínica; quota passa a aplicar; pausa bloqueia autoBookPaused', async () => {
    const s = seed()
    try {
      s.addContact('a', '5511900000199')
      // Sem enable da clínica → quota não aplica mesmo com limites baixos no objeto passado?
      // Aqui exercitamos persistência + resolve.
      updateClinicAbuseLimits(
        s.db,
        s.tenantId,
        { enabled: true, autoDraftsPerContact: 1 },
        s.clock,
      )
      const platform = abuseLimitsFromEnv({})
      const settings = updateClinicAbuseLimits(
        s.db,
        s.tenantId,
        { enabled: true, autoDraftsPerContact: 1 },
        s.clock,
        platform,
      )
      const effective = resolveAbuseLimits(platform, {
        enabled: settings.abuseLimitsEnabled,
        windowHours: settings.abuseWindowHours,
        autoDraftsPerContact: settings.abuseAutoDraftsPerContact,
        futureAppointmentsPerContact: settings.abuseFutureAppointmentsPerContact,
        pendingPixPerContact: settings.abusePendingPixPerContact,
        pendingProposalsPerContact: settings.abusePendingProposalsPerContact,
        proposalsPerContact: settings.abuseProposalsPerContact,
        proposalsPerClinic: settings.abuseProposalsPerClinic,
      })
      expect(effective.enabled).toBe(true)
      expect(effective.autoDraftsPerContact).toBe(1)

      s.inbound('a', 'primeira')
      const first = await s.drain(effective)
      expect(first[0]?.status).toBe('ready')
      s.inbound('a', 'segunda')
      const second = await s.drain(effective)
      expect(second[0]?.status).toMatch(/^skipped|abuse_limit/)
      expect(second[0]?.reason ?? second[0]?.status).toMatch(/abuse_limit/)

      updateClinicAbuseLimits(s.db, s.tenantId, { autoBookPaused: true }, s.clock)
      const paused = toAiAssistDeps({
        mode: 'synthetic',
        autoBookPaused: true,
        abuseLimits: effective,
      })
      expect(paused.autoBookPaused).toBe(true)
      expect(paused.autoBookPaused !== true).toBe(false)
    } finally {
      s.close()
    }
  })
})
