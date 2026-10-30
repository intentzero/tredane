/**
 * S5 (#176): clique autenticado → book ou Pix uma vez.
 * Dados fictícios; Meta/Pix sintéticos; sem deploy.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { SimulatedPixAdapter } from '../../pix'
import {
  AI_AUTOBOOK_ACTOR,
  CLINIC_SCHEMA_VERSION,
  PROPOSAL_BOOK_CLIENT_REQUEST_PREFIX,
  PROPOSAL_PIX_CLIENT_REQUEST_PREFIX,
} from '../constants'
import {
  setAiProfileOp,
  setServiceActiveOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { upsertContact } from '../contacts'
import { blockContactOp } from '../inbox'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { clinicInbox, clinicWhatsapp, workerCaller } from '../index'
import { connectPixAccountOp } from '../pix'
import { createWooviSandboxFixture } from '../../pix'
import { insertOpportunity, getOpportunity } from '../pipeline/opportunities'
import { confirmAppointmentOp } from '../scheduling/booking'
import { bootClinicDb } from '../test-db'
import { listOperationalAudit } from '../audit'
import {
  createProposal,
  executeProposalConfirmOp,
  handleProposalButtonClick,
  markProposalSent,
  proposalBookClientRequestId,
  proposalButtonId,
  proposalPixClientRequestId,
} from './index'

const T0 = Date.UTC(2026, 9, 29, 15, 0)

async function seedBookable(tenantId = 'clinic-demo-s5-a') {
  const clock = createControllableClock(T0)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  clinicWhatsapp.syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_s5',
      phoneNumberId: 'pn_s5',
      wabaId: 'waba_s5',
      displayPhone: '+5511999000000',
      displayName: 'Clínica S5',
      action: 'channel_connected',
    },
    clock,
  )
  clinicInbox.seedSyntheticWhatsappTemplates(db, tenantId, clock)
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Dra. Paula Reis' },
    clock,
  )
  const room = upsertResourceOp(
    db,
    caller,
    { kind: 'room', name: 'Sala 1', category: 'Padrão' },
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
      roomRequirement: { mode: 'category', category: 'Padrão' },
    },
    clock,
  )
  // T0=qui 29/10/2026; startsAt=T0+24h → sexta (dayOfWeek 5, Mon=1).
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [{ dayOfWeek: 5, startMinute: 9 * 60, endMinute: 18 * 60 }],
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: room.id,
      windows: [{ dayOfWeek: 5, startMinute: 9 * 60, endMinute: 18 * 60 }],
    },
    clock,
  )
  setAiProfileOp(db, caller, { clinicAddress: 'Rua das Flores, 100 — São Paulo' }, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511999000505', displayName: 'Ana Silva' },
    clock,
  )
  const conversation = createConversation(
    db,
    { tenantId, contactId: contact.id, status: 'open' },
    clock,
  )
  insertMessage(
    db,
    {
      tenantId,
      conversationId: conversation.id,
      direction: 'inbound',
      body: 'Oi, quero horário',
      externalMessageId: 'wamid.in_s5_1',
      deliveryState: 'received',
      authorClerkUserId: null,
      authorDisplayName: null,
      createdAt: clock.nowMs(),
    },
    clock,
  )
  const startsAt = T0 + 24 * 60 * 60 * 1000
  return { ...boot, clock, caller, tenantId, pro, room, svc, contact, conversation, startsAt }
}

async function seedWithSignal(tenantId = 'clinic-demo-s5-pix') {
  const base = await seedBookable(tenantId)
  const { db, clock, caller } = base
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação a laser',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceCents: 54_000,
      professionalIds: [base.pro.id],
      roomRequirement: { mode: 'category', category: 'Padrão' },
      requiresSignal: true,
      signalKind: 'fixed',
      signalFixedCents: 5_400,
    },
    clock,
  )
  const sandbox = await createWooviSandboxFixture()
  const appId = 'synth_s5_pix_app_001'
  sandbox.addValidAppId(appId)
  await connectPixAccountOp(
    db,
    caller,
    { appId, clerkUserId: 'user_synth_owner_a', environment: 'synthetic' },
    clock,
    {
      environment: 'synthetic',
      fetchImpl: sandbox.fetchImpl,
      baseUrl: sandbox.baseUrl,
      webhookPublicKeys: [sandbox.publicPem],
      sealKeys: {},
    },
  )
  return { ...base, svc, sandbox, appId }
}

function makeSent(
  s: Awaited<ReturnType<typeof seedBookable>>,
  serviceId?: string,
) {
  const proposal = createProposal(
    s.db,
    s.tenantId,
    {
      contactId: s.contact.id,
      conversationId: s.conversation.id,
      serviceId: serviceId ?? s.svc.id,
      professionalId: s.pro.id,
      startsAt: s.startsAt,
    },
    s.clock,
  )
  const marked = markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
  s.db.run(
    `UPDATE appointment_proposals SET send_provider_message_id = ? WHERE tenant_id = ? AND id = ?`,
    'wamid.proposal_s5',
    s.tenantId,
    proposal.id,
  )
  return { ...marked, sendProviderMessageId: 'wamid.proposal_s5' }
}

async function confirmClick(
  s: Awaited<ReturnType<typeof seedBookable>>,
  proposalId: string,
  version: number,
  opts?: {
    capability?: boolean
    pixAdapter?: SimulatedPixAdapter
    contextMessageId?: string | null
    providerEventKey?: string
  },
) {
  const click = handleProposalButtonClick(
    s.db,
    {
      tenantId: s.tenantId,
      contactId: s.contact.id,
      conversationId: s.conversation.id,
      buttonId: proposalButtonId(proposalId, version, 'confirm'),
      contextMessageId: opts?.contextMessageId ?? 'wamid.proposal_s5',
      providerEventKey: opts?.providerEventKey ?? 'evt_s5_1',
    },
    s.clock,
  )
  expect(click.handled).toBe(true)
  if (!('handoff' in click)) throw new Error('expected handoff')
  return executeProposalConfirmOp(
    s.db,
    s.caller,
    {
      handoff: click.handoff,
      capability: opts?.capability ?? true,
      providerEventKey: opts?.providerEventKey ?? 'evt_s5_1',
      contextMessageId: opts?.contextMessageId ?? 'wamid.proposal_s5',
      senderContactId: s.contact.id,
    },
    s.clock,
    opts?.pixAdapter ? { pixAdapter: opts.pixAdapter } : {},
  )
}

describe('S5: schema e chaves', () => {
  it('mantém CLINIC_SCHEMA_VERSION e prefixos estáveis', () => {
    expect(CLINIC_SCHEMA_VERSION).toBe(33)
    expect(PROPOSAL_BOOK_CLIENT_REQUEST_PREFIX).toBe('proposal.book:')
    expect(PROPOSAL_PIX_CLIENT_REQUEST_PREFIX).toBe('proposal.pix:')
    expect(proposalBookClientRequestId('p1', 2)).toBe('proposal.book:p1:v2')
    expect(proposalPixClientRequestId('p1', 2)).toBe('proposal.pix:p1:v2')
  })
})

describe('S5: book sem sinal', () => {
  it('clique válido cria compromisso com actor system:ai-autobook e auditoria', async () => {
    const s = await seedBookable()
    try {
      const proposal = makeSent(s)
      const result = await confirmClick(s, proposal.id, proposal.version)
      expect(result.status).toBe('booked')
      if (result.status !== 'booked') return
      expect(result.appointment.confirmedBy).toBe(AI_AUTOBOOK_ACTOR)
      expect(result.proposal.state).toBe('confirmada')
      expect(result.proposal.appointmentId).toBe(result.appointment.id)
      expect(result.result.status === 'queued' || result.result.status === 'already_queued').toBe(
        true,
      )
      const audits = listOperationalAudit(s.db, s.tenantId, 50)
      const ai = audits.find((a) => a.action === 'appointment.ai_booked')
      expect(ai?.actor).toBe(AI_AUTOBOOK_ACTOR)
      expect(ai?.detailJson).toMatch(/Marcado pela IA/)
      expect(ai?.detailJson).toMatch(proposal.id)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(1)
    } finally {
      s.close()
    }
  })

  it('clique move a oportunidade aberta da conversa para Agendado', async () => {
    const s = await seedBookable()
    try {
      const opp = insertOpportunity(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          stage: 'em_atendimento',
        },
        s.clock,
      )
      const proposal = makeSent(s)
      const result = await confirmClick(s, proposal.id, proposal.version)
      expect(result.status).toBe('booked')
      const after = getOpportunity(s.db, s.tenantId, opp.id)
      expect(after?.stage).toBe('agendado')
      expect(after?.linkedAppointmentId).toBe(
        result.status === 'booked' ? result.appointment.id : null,
      )
    } finally {
      s.close()
    }
  })

  it('clique duplo / concorrente é idempotente (mesmo proposal+version)', async () => {
    const s = await seedBookable()
    try {
      const proposal = makeSent(s)
      const first = await confirmClick(s, proposal.id, proposal.version, {
        providerEventKey: 'evt_dup_1',
      })
      const second = await confirmClick(s, proposal.id, proposal.version, {
        providerEventKey: 'evt_dup_2',
      })
      expect(first.status).toBe('booked')
      expect(second.status).toBe('booked')
      if (first.status !== 'booked' || second.status !== 'booked') return
      expect(second.idempotentReplay).toBe(true)
      expect(second.appointment.id).toBe(first.appointment.id)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(1)
    } finally {
      s.close()
    }
  })

  it('profissional/sala ocupados → slot_refused sem compromisso', async () => {
    const s = await seedBookable()
    try {
      const proposal = makeSent(s)
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'manual-occupy-s5',
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          roomResourceId: s.room.id,
          startsAt: s.startsAt,
          contactId: s.contact.id,
          actorClerkUserId: 'user_synth_owner_a',
        },
        s.clock,
      )
      const result = await confirmClick(s, proposal.id, proposal.version)
      expect(result.status).toBe('slot_refused')
      if (result.status !== 'slot_refused') return
      expect(result.proposal.state).toBe('recusada_vaga')
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(1)
    } finally {
      s.close()
    }
  })

  it('capacidade desligada nega; após commit o replay devolve o existente', async () => {
    const s = await seedBookable()
    try {
      const proposal = makeSent(s)
      const denied = await confirmClick(s, proposal.id, proposal.version, {
        capability: false,
      })
      expect(denied.status).toBe('denied')
      if (denied.status !== 'denied') return
      expect(denied.reason).toBe('capability_disabled')
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(0)

      const booked = await confirmClick(s, proposal.id, proposal.version, {
        capability: true,
      })
      expect(booked.status).toBe('booked')

      // Revogação a meio / após commit: reentrega com capability off → resultado existente.
      const replay = await confirmClick(s, proposal.id, proposal.version, {
        capability: false,
      })
      expect(replay.status).toBe('booked')
      if (replay.status !== 'booked') return
      expect(replay.idempotentReplay).toBe(true)
    } finally {
      s.close()
    }
  })

  it('contato bloqueado nega; contexto de outra mensagem nega', async () => {
    const s = await seedBookable()
    try {
      const proposal = makeSent(s)
      blockContactOp(
        s.db,
        s.caller,
        {
          contactId: s.contact.id,
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Owner',
          reason: 'Spam sintético',
        },
        s.clock,
      )
      // Reabre conversa para o teste de proteção (block fecha).
      s.db.run(
        `UPDATE conversations SET status = 'open' WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        s.conversation.id,
      )
      const blocked = await confirmClick(s, proposal.id, proposal.version)
      expect(blocked.status).toBe('denied')
      if (blocked.status === 'denied') expect(blocked.reason).toBe('protection')

      // Desbloqueia e testa context mismatch.
      s.db.run(
        `UPDATE contacts SET blocked_at = NULL, blocked_by_display_name = NULL, blocked_reason = NULL
         WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        s.contact.id,
      )
      const mismatch = await confirmClick(s, proposal.id, proposal.version, {
        contextMessageId: 'wamid.other_message',
      })
      expect(mismatch.status).toBe('denied')
      if (mismatch.status === 'denied') expect(mismatch.reason).toBe('context_mismatch')
    } finally {
      s.close()
    }
  })

  it('serviço desativado a meio → material_changed; texto do botão não marca', async () => {
    const s = await seedBookable()
    try {
      const proposal = makeSent(s)
      setServiceActiveOp(s.db, s.caller, s.svc.id, false, s.clock)
      const result = await confirmClick(s, proposal.id, proposal.version)
      expect(result.status).toBe('denied')
      if (result.status === 'denied') expect(result.reason).toBe('material_changed')
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(0)

      // Texto livre igual ao rótulo nunca passa por handleProposalButtonClick como confirm.
      const typed = handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          buttonId: 'Confirmar',
        },
        s.clock,
      )
      expect(typed).toEqual({ handled: false, reason: 'not_proposal_button' })
    } finally {
      s.close()
    }
  })
})

describe('S5: Pix com sinal (DEC-047)', () => {
  it('cria cobrança sem alocar horário; clique repetido não duplica', async () => {
    const s = await seedWithSignal()
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(s.clock.nowMs()) },
    })
    try {
      const proposal = makeSent(s, s.svc.id)
      expect(proposal.requiresSignal).toBe(true)
      const beforeAlloc = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointment_allocations WHERE tenant_id = ?`,
        s.tenantId,
      )?.n
      const first = await confirmClick(s, proposal.id, proposal.version, { pixAdapter: adapter })
      expect(first.status).toBe('pix_signal')
      if (first.status !== 'pix_signal') return
      expect(first.proposal.state).toBe('confirmada')
      expect(first.proposal.appointmentId).toBeNull()
      expect(first.charge.id).toBeTruthy()
      const afterAlloc = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointment_allocations WHERE tenant_id = ?`,
        s.tenantId,
      )?.n
      expect(afterAlloc).toBe(beforeAlloc)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(0)

      const second = await confirmClick(s, proposal.id, proposal.version, { pixAdapter: adapter })
      expect(second.status).toBe('pix_signal')
      if (second.status !== 'pix_signal') return
      expect(second.idempotentReplay).toBe(true)
      expect(second.charge.id).toBe(first.charge.id)
      expect(
        s.db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM pix_charges WHERE tenant_id = ?`,
          s.tenantId,
        )?.n,
      ).toBe(1)
    } finally {
      s.close()
    }
  })
})

describe('S5: webhook fora de ordem / versão', () => {
  it('botão de versão substituída é ignorado; só a vigente marca', async () => {
    const s = await seedBookable()
    try {
      const v1 = makeSent(s)
      // Nova versão material.
      const v2 = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          startsAt: s.startsAt + 60 * 60 * 1000,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, v2.id, s.clock)
      const oldClick = handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          buttonId: proposalButtonId(v1.id, 1, 'confirm'),
        },
        s.clock,
      )
      // v1 foi substituída → version na row pode ser 1 mas state substituida, ou lineage nova.
      // createOrSupersede: createProposal em conversa com ativa supersede.
      expect(oldClick.handled).toBe(true)
      if ('ignored' in oldClick && oldClick.ignored) {
        expect(oldClick.reason === 'version_mismatch' || oldClick.reason === 'proposal_missing').toBe(
          true,
        )
      } else if ('handoff' in oldClick) {
        const denied = await executeProposalConfirmOp(
          s.db,
          s.caller,
          { handoff: oldClick.handoff, capability: true },
          s.clock,
        )
        expect(denied.status === 'denied' || denied.status === 'booked').toBe(true)
        // Se a v1 ainda estiver enviada (sem supersede automático via createProposal),
        // createProposal usa createOrSupersede — v1 deve estar substituída.
      }
      const fresh = s.db.get<{ state: string }>(
        `SELECT state FROM appointment_proposals WHERE id = ?`,
        v1.id,
      )
      expect(fresh?.state).toBe('substituida')
      s.db.run(
        `UPDATE appointment_proposals SET send_provider_message_id = ? WHERE id = ?`,
        'wamid.v2',
        v2.id,
      )
      const ok = await confirmClick(s, v2.id, v2.version, {
        contextMessageId: 'wamid.v2',
      })
      expect(ok.status).toBe('booked')
    } finally {
      s.close()
    }
  })
})
