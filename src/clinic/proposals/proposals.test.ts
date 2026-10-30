/**
 * S3 (#174): propostas versionadas, expiráveis e vinculadas ao contacto.
 * Dados fictícios. Não marca horário nem envia WhatsApp.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import {
  PROPOSED_ABUSE_LIMITS,
  type AbuseLimits,
} from '../ai/abuse-limits'
import {
  APPOINTMENT_PROPOSAL_VALIDITY_MS,
  CLINIC_SCHEMA_VERSION,
} from '../constants'
import {
  setAiProfileOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { upsertContact } from '../contacts'
import { ConflictError, ValidationError, workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { deleteContactOp } from '../retention/contact-delete'
import { bootClinicDb } from '../test-db'
import {
  createOrSupersedeProposal,
  createProposal,
  evaluateProposalAuthorization,
  expireProposalIfNeeded,
  getActiveProposalForConversation,
  getProposal,
  markProposalConfirmed,
  markProposalSendPending,
  markProposalSent,
  markProposalSlotRefused,
  restoreProposalAuthorization,
} from './index'

const TZ_START = Date.UTC(2026, 9, 28, 15, 0) // 28/10/2026 12:00 SP-ish absolute

function seed(tenantId = 'clinic-demo-proposals-a') {
  const clock = createControllableClock(TZ_START)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  const room = upsertResourceOp(
    db,
    caller,
    { kind: 'room', name: 'Sala 1' },
    clock,
  )
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Dra. Paula Reis', homeRoomId: room.id },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Limpeza de pele',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceCents: 18_000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [{ dayOfWeek: 3, startMinute: 9 * 60, endMinute: 18 * 60 }],
    },
    clock,
  )
  setAiProfileOp(
    db,
    caller,
    { clinicAddress: 'Rua das Flores, 100 — São Paulo' },
    clock,
  )
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511999000101', displayName: 'Ana Silva' },
    clock,
  )
  const conversation = createConversation(
    db,
    { tenantId, contactId: contact.id, status: 'open' },
    clock,
  )
  const startsAt = TZ_START + 24 * 60 * 60 * 1000
  return {
    ...boot,
    clock,
    caller,
    tenantId,
    pro,
    svc,
    contact,
    conversation,
    startsAt,
  }
}

describe('S3: schema', () => {
  it('migração 28 cria appointment_proposals e sobe CLINIC_SCHEMA_VERSION', () => {
    const { db, close } = bootClinicDb()
    try {
      const state = db.get<{ version: number; status: string }>(
        'SELECT version, status FROM clinic_schema_state WHERE id = 1',
      )
      expect(state).toEqual({ version: CLINIC_SCHEMA_VERSION, status: 'ready' })
      expect(CLINIC_SCHEMA_VERSION).toBeGreaterThanOrEqual(28)
      const table = db.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='appointment_proposals'`,
      )
      expect(table?.name).toBe('appointment_proposals')
    } finally {
      close()
    }
  })
})

describe('S3: persistência e validação', () => {
  it('persiste factos validados; não cria compromisso nem alocação', () => {
    const s = seed()
    try {
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          startsAt: s.startsAt,
        },
        s.clock,
      )
      expect(proposal.state).toBe('preparada')
      expect(proposal.version).toBe(1)
      expect(proposal.lineageId).toBe(proposal.id)
      expect(proposal.serviceName).toBe('Limpeza de pele')
      expect(proposal.priceCents).toBe(18_000)
      expect(proposal.clinicLocationText).toContain('Rua das Flores')
      expect(proposal.beneficiaryName).toBe('Ana Silva')
      expect(proposal.expiresAt).toBeNull()
      expect(proposal.id.startsWith('aprop_')).toBe(true)

      const appts = s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)
      const allocs = s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointment_allocations`)
      expect(appts?.n).toBe(0)
      expect(allocs?.n).toBe(0)

      const again = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          startsAt: s.startsAt,
        },
        s.clock,
      )
      expect(again.id).toBe(proposal.id)
      const created = s.db.all<{ detail_json: string }>(
        `SELECT detail_json FROM operational_audit WHERE tenant_id = ? AND action = 'proposal.created'`,
        s.tenantId,
      )
      expect(created).toHaveLength(1)
      expect(JSON.parse(created[0]!.detail_json)).toEqual({
        proposalVersion: 1,
        contactId: s.contact.id,
        conversationId: s.conversation.id,
      })
      expect(created[0]!.detail_json).not.toContain('Ana')
      expect(created[0]!.detail_json).not.toContain('Limpeza')
    } finally {
      s.close()
    }
  })

  it('DEC-076: rejeita duração diferente da do cadastro', () => {
    const s = seed()
    try {
      expect(() =>
        createProposal(
          s.db,
          s.tenantId,
          {
            contactId: s.contact.id,
            conversationId: s.conversation.id,
            serviceId: s.svc.id,
            professionalId: s.pro.id,
            startsAt: s.startsAt,
            durationMinutes: 90,
          },
          s.clock,
        ),
      ).toThrow(ValidationError)
    } finally {
      s.close()
    }
  })

  it('rejeita serviço / profissional / conversa fabricados', () => {
    const s = seed()
    try {
      expect(() =>
        createProposal(
          s.db,
          s.tenantId,
          {
            contactId: s.contact.id,
            conversationId: s.conversation.id,
            serviceId: 'svc_fabricado_llm',
            startsAt: s.startsAt,
          },
          s.clock,
        ),
      ).toThrow(ValidationError)

      expect(() =>
        createProposal(
          s.db,
          s.tenantId,
          {
            contactId: s.contact.id,
            conversationId: s.conversation.id,
            serviceId: s.svc.id,
            professionalId: 'res_fabricado_llm',
            startsAt: s.startsAt,
          },
          s.clock,
        ),
      ).toThrow(ValidationError)

      const other = upsertContact(
        s.db,
        { tenantId: s.tenantId, waId: '5511999000102', displayName: 'Bia Costa' },
        s.clock,
      )
      expect(() =>
        createProposal(
          s.db,
          s.tenantId,
          {
            contactId: other.id,
            conversationId: s.conversation.id,
            serviceId: s.svc.id,
            startsAt: s.startsAt,
          },
          s.clock,
        ),
      ).toThrow(ValidationError)
    } finally {
      s.close()
    }
  })
})

describe('S3: máquina de estados, vigência e substituição', () => {
  it('envio inicia 30 min; expiração preguiçosa sem job; só enviada autoriza', () => {
    const s = seed()
    try {
      const p = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.svc.id,
          startsAt: s.startsAt,
        },
        s.clock,
      )
      markProposalSendPending(s.db, s.tenantId, p.id, s.clock)
      const sent = markProposalSent(s.db, s.tenantId, p.id, s.clock)
      expect(sent.state).toBe('enviada')
      expect(sent.expiresAt).toBe(TZ_START + APPOINTMENT_PROPOSAL_VALIDITY_MS)

      const ok = evaluateProposalAuthorization(
        s.db,
        {
          tenantId: s.tenantId,
          proposalId: p.id,
          contactId: s.contact.id,
          conversationId: s.conversation.id,
        },
        s.clock,
      )
      expect(ok.allowed).toBe(true)

      s.clock.advance(APPOINTMENT_PROPOSAL_VALIDITY_MS)
      const expiredAuth = evaluateProposalAuthorization(
        s.db,
        {
          tenantId: s.tenantId,
          proposalId: p.id,
          contactId: s.contact.id,
          conversationId: s.conversation.id,
        },
        s.clock,
      )
      expect(expiredAuth.allowed).toBe(false)
      if (!expiredAuth.allowed) expect(expiredAuth.reason).toBe('expired')
      expect(getProposal(s.db, s.tenantId, p.id)?.state).toBe('expirada')
      expect(getActiveProposalForConversation(s.db, s.tenantId, s.conversation.id, s.clock)).toBeNull()
    } finally {
      s.close()
    }
  })

  it('edição material invalida a versão anterior; clique antigo não confirma a nova', () => {
    const s = seed()
    try {
      const first = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.svc.id,
          startsAt: s.startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, first.id, s.clock)

      const { proposal: second, superseded } = createOrSupersedeProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.svc.id,
          startsAt: s.startsAt + 60 * 60 * 1000,
        },
        s.clock,
      )
      expect(superseded?.id).toBe(first.id)
      expect(getProposal(s.db, s.tenantId, first.id)?.state).toBe('substituida')
      expect(second.version).toBe(2)
      expect(second.lineageId).toBe(first.lineageId)
      expect(second.id).not.toBe(first.id)

      const oldClick = evaluateProposalAuthorization(
        s.db,
        {
          tenantId: s.tenantId,
          proposalId: first.id,
          contactId: s.contact.id,
          conversationId: s.conversation.id,
        },
        s.clock,
      )
      expect(oldClick.allowed).toBe(false)
      if (!oldClick.allowed) expect(oldClick.reason).toBe('not_enviada')

      markProposalSent(s.db, s.tenantId, second.id, s.clock)
      const newClick = evaluateProposalAuthorization(
        s.db,
        {
          tenantId: s.tenantId,
          proposalId: second.id,
          contactId: s.contact.id,
          conversationId: s.conversation.id,
        },
        s.clock,
      )
      expect(newClick.allowed).toBe(true)
      const created = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM operational_audit WHERE tenant_id = ? AND action = 'proposal.created'`,
        s.tenantId,
      )
      expect(created?.n).toBe(2)
    } finally {
      s.close()
    }
  })

  it('id fabricado / cruzado entre clínicas ou conversas não autoriza', () => {
    const a = seed('clinic-demo-proposals-a')
    const b = seed('clinic-demo-proposals-b')
    try {
      const pa = createProposal(
        a.db,
        a.tenantId,
        {
          contactId: a.contact.id,
          conversationId: a.conversation.id,
          serviceId: a.svc.id,
          startsAt: a.startsAt,
        },
        a.clock,
      )
      markProposalSent(a.db, a.tenantId, pa.id, a.clock)

      expect(
        evaluateProposalAuthorization(
          a.db,
          {
            tenantId: a.tenantId,
            proposalId: 'aprop_fabricado_pelo_llm',
            contactId: a.contact.id,
            conversationId: a.conversation.id,
          },
          a.clock,
        ),
      ).toMatchObject({ allowed: false, reason: 'fabricated_id' })

      // Mesmo id opaco noutro tenant DO → not found / fabricated neste DO.
      expect(
        evaluateProposalAuthorization(
          b.db,
          {
            tenantId: b.tenantId,
            proposalId: pa.id,
            contactId: b.contact.id,
            conversationId: b.conversation.id,
          },
          b.clock,
        ),
      ).toMatchObject({ allowed: false, reason: 'fabricated_id' })

      const otherConv = createConversation(
        a.db,
        { tenantId: a.tenantId, contactId: a.contact.id, status: 'open' },
        a.clock,
      )
      expect(
        evaluateProposalAuthorization(
          a.db,
          {
            tenantId: a.tenantId,
            proposalId: pa.id,
            contactId: a.contact.id,
            conversationId: otherConv.id,
          },
          a.clock,
        ),
      ).toMatchObject({ allowed: false, reason: 'conversation_mismatch' })
    } finally {
      a.close()
      b.close()
    }
  })

  it('transição concorrente / estado errado é recusada no servidor', () => {
    const s = seed()
    try {
      const p = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.svc.id,
          startsAt: s.startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, p.id, s.clock)
      markProposalSlotRefused(s.db, s.tenantId, p.id, s.clock)
      expect(() => markProposalConfirmed(s.db, s.tenantId, p.id, s.clock)).toThrow(ConflictError)
    } finally {
      s.close()
    }
  })

  it('restore não reativa autorização consumida', () => {
    const s = seed()
    try {
      const p = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.svc.id,
          startsAt: s.startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, p.id, s.clock)
      markProposalConfirmed(s.db, s.tenantId, p.id, s.clock, 'appt_synth_1')
      expect(() => restoreProposalAuthorization(s.db, s.tenantId, p.id, s.clock)).toThrow(
        ConflictError,
      )
      expect(getProposal(s.db, s.tenantId, p.id)?.state).toBe('confirmada')
      expect(
        evaluateProposalAuthorization(
          s.db,
          {
            tenantId: s.tenantId,
            proposalId: p.id,
            contactId: s.contact.id,
            conversationId: s.conversation.id,
          },
          s.clock,
        ).allowed,
      ).toBe(false)
    } finally {
      s.close()
    }
  })
})

describe('S3: exclusão de contacto e quotas', () => {
  it('exclusão de contacto remove propostas; id antigo deixa de autorizar', () => {
    const s = seed()
    try {
      const p = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.svc.id,
          startsAt: s.startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, p.id, s.clock)
      const proposalId = p.id
      deleteContactOp(s.db, s.caller, s.contact.id, s.clock)
      expect(getProposal(s.db, s.tenantId, proposalId)).toBeNull()
      expect(
        evaluateProposalAuthorization(
          s.db,
          {
            tenantId: s.tenantId,
            proposalId,
            contactId: s.contact.id,
            conversationId: s.conversation.id,
          },
          s.clock,
        ),
      ).toMatchObject({ allowed: false, reason: 'fabricated_id' })
    } finally {
      s.close()
    }
  })

  it('limites de abuso (desligados por padrão) contam propostas quando ligados', () => {
    const s = seed()
    try {
      expect(PROPOSED_ABUSE_LIMITS.enabled).toBe(false) // alias de DEFAULT_ABUSE_LIMITS; fail-closed
      createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.svc.id,
          startsAt: s.startsAt,
        },
        s.clock,
      )
      const limits: AbuseLimits = {
        ...PROPOSED_ABUSE_LIMITS,
        enabled: true,
        pendingProposalsPerContact: 1,
        proposalsPerContact: 1,
        proposalsPerClinic: 1,
      }
      expect(() =>
        createProposal(
          s.db,
          s.tenantId,
          {
            contactId: s.contact.id,
            conversationId: s.conversation.id,
            serviceId: s.svc.id,
            startsAt: s.startsAt + 3_600_000,
          },
          s.clock,
          { abuseLimits: limits },
        ),
      ).toThrow(ConflictError)

      // Substituição com teto de criação folgado: pending=1 não bloqueia replace.
      const replaceLimits: AbuseLimits = {
        ...PROPOSED_ABUSE_LIMITS,
        enabled: true,
        pendingProposalsPerContact: 1,
        proposalsPerContact: 10,
        proposalsPerClinic: 10,
      }
      const next = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.svc.id,
          startsAt: s.startsAt + 7_200_000,
        },
        s.clock,
        { abuseLimits: replaceLimits },
      )
      expect(next.version).toBe(2)
    } finally {
      s.close()
    }
  })

  it('expireProposalIfNeeded é idempotente', () => {
    const s = seed()
    try {
      const p = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.svc.id,
          startsAt: s.startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, p.id, s.clock)
      s.clock.advance(APPOINTMENT_PROPOSAL_VALIDITY_MS + 1)
      const a = expireProposalIfNeeded(s.db, s.tenantId, p.id, s.clock)
      const b = expireProposalIfNeeded(s.db, s.tenantId, p.id, s.clock)
      expect(a?.state).toBe('expirada')
      expect(b?.state).toBe('expirada')
    } finally {
      s.close()
    }
  })
})
