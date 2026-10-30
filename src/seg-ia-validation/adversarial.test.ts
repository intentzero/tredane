/**
 * S9 (#180): cenários adversariais e regressões de autorização.
 * Dados fictícios; sem deploy; sem AI_AUTOBOOK em clínica real.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { listOperationalAudit } from '../clinic/audit'
import {
  setAiProfileOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../clinic/config'
import {
  AI_AUTOBOOK_ACTOR,
  APPOINTMENT_PROPOSAL_VALIDITY_MS,
  CLINIC_SCHEMA_VERSION,
} from '../clinic/constants'
import { upsertContact } from '../clinic/contacts'
import { createConversation } from '../clinic/inbox/conversations'
import { insertMessage } from '../clinic/inbox/messages'
import { clinicInbox, clinicWhatsapp, queueCaller, workerCaller } from '../clinic/index'
import { runClinicMigrations } from '../clinic/migrations'
import {
  createProposal,
  executeProposalConfirmOp,
  evaluateProposalAuthorization,
  handleProposalButtonClick,
  markProposalSendPending,
  markProposalSendUncertain,
  markProposalSent,
  proposalButtonId,
  reconcileProposalResultOutboundSend,
  proposalResultClientRequestId,
  sendProposalToWhatsAppOp,
} from '../clinic/proposals'
import { confirmAppointmentOp } from '../clinic/scheduling/booking'
import { fromNodeSqlite } from '../clinic/store'
import { bootClinicDb } from '../clinic/test-db'
import { ingestWhatsappWebhook } from '../whatsapp/webhook-ingest'
import {
  computeHubSignature256,
  SYNTHETIC_APP_SECRET,
} from '../whatsapp/webhook-verify'

const T0 = Date.UTC(2026, 9, 29, 15, 0)

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

async function seedBookable(tenantId = 'clinic-demo-s9-a') {
  const clock = createControllableClock(T0)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  clinicWhatsapp.syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_s9',
      phoneNumberId: 'pn_s9',
      wabaId: 'waba_s9',
      displayPhone: '+5511999000000',
      displayName: 'Clínica S9',
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
    { tenantId, waId: '5511999000909', displayName: 'Ana Silva' },
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
      externalMessageId: 'wamid.in_s9_1',
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

function makeSent(s: Awaited<ReturnType<typeof seedBookable>>, providerMsgId = 'wamid.proposal_s9') {
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
  const marked = markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
  s.db.run(
    `UPDATE appointment_proposals SET send_provider_message_id = ? WHERE tenant_id = ? AND id = ?`,
    providerMsgId,
    s.tenantId,
    proposal.id,
  )
  return { ...marked, sendProviderMessageId: providerMsgId }
}

async function confirmClick(
  s: Awaited<ReturnType<typeof seedBookable>>,
  proposalId: string,
  version: number,
  opts?: {
    capability?: boolean
    contactId?: string
    conversationId?: string
    contextMessageId?: string | null
    providerEventKey?: string
    buttonId?: string
  },
) {
  const click = handleProposalButtonClick(
    s.db,
    {
      tenantId: s.tenantId,
      contactId: opts?.contactId ?? s.contact.id,
      conversationId: opts?.conversationId ?? s.conversation.id,
      buttonId: opts?.buttonId ?? proposalButtonId(proposalId, version, 'confirm'),
      contextMessageId: opts?.contextMessageId ?? 'wamid.proposal_s9',
      providerEventKey: opts?.providerEventKey ?? 'evt_s9_1',
    },
    s.clock,
  )
  if (!click.handled) {
    return { status: 'not_handled' as const, reason: click.reason, click }
  }
  if ('ignored' in click && click.ignored) {
    return { status: 'ignored' as const, reason: click.reason, click }
  }
  if (!('handoff' in click)) {
    return { status: 'no_handoff' as const, click }
  }
  const result = await executeProposalConfirmOp(
    s.db,
    s.caller,
    {
      handoff: click.handoff,
      capability: opts?.capability ?? true,
      providerEventKey: opts?.providerEventKey ?? 'evt_s9_1',
      contextMessageId: opts?.contextMessageId ?? 'wamid.proposal_s9',
      senderContactId: opts?.contactId ?? s.contact.id,
    },
    s.clock,
  )
  return { ...result, click }
}

function appointmentCount(s: { db: ReturnType<typeof bootClinicDb>['db']; tenantId: string }) {
  return s.db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`,
    s.tenantId,
  )?.n
}

function allocationCount(s: { db: ReturnType<typeof bootClinicDb>['db']; tenantId: string }) {
  return s.db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointment_allocations WHERE tenant_id = ?`,
    s.tenantId,
  )?.n
}

describe('S9: schema estável', () => {
  it('mantém CLINIC_SCHEMA_VERSION com propostas/envio/limites', () => {
    expect(CLINIC_SCHEMA_VERSION).toBe(35)
  })
})

describe('S9: proposta/consentimento nunca reservam horário', () => {
  it('criar e marcar enviada não aloca slot; só o clique book aloca', async () => {
    const s = await seedBookable()
    try {
      const before = allocationCount(s) ?? 0
      const proposal = makeSent(s)
      expect(proposal.state).toBe('enviada')
      expect(allocationCount(s)).toBe(before)
      expect(appointmentCount(s)).toBe(0)
      const booked = await confirmClick(s, proposal.id, proposal.version)
      expect(booked.status).toBe('booked')
      expect((allocationCount(s) ?? 0) > before).toBe(true)
    } finally {
      s.close()
    }
  })
})

describe('S9: remetente/tenant/conversa trocados', () => {
  it('contato errado no clique → denied; zero compromissos', async () => {
    const s = await seedBookable()
    try {
      const proposal = makeSent(s)
      const intruder = upsertContact(
        s.db,
        { tenantId: s.tenantId, waId: '5511999000910', displayName: 'Intrusa Falsa' },
        s.clock,
      )
      const denied = await confirmClick(s, proposal.id, proposal.version, {
        contactId: intruder.id,
      })
      expect(denied.status).toBe('denied')
      if (denied.status === 'denied') {
        expect(denied.reason).toBe('authorization')
        expect(denied.authorizationReason).toBe('contact_mismatch')
      }
      expect(appointmentCount(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('conversa errada → authorization conversation_mismatch', async () => {
    const s = await seedBookable()
    try {
      const proposal = makeSent(s)
      const other = createConversation(
        s.db,
        { tenantId: s.tenantId, contactId: s.contact.id, status: 'open' },
        s.clock,
      )
      const denied = await confirmClick(s, proposal.id, proposal.version, {
        conversationId: other.id,
      })
      expect(denied.status).toBe('denied')
      if (denied.status === 'denied') {
        expect(denied.authorizationReason).toBe('conversation_mismatch')
      }
      expect(appointmentCount(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('botão fabricado / id de outro tenant → ignored; zero book', async () => {
    const a = await seedBookable('clinic-demo-s9-a')
    const b = await seedBookable('clinic-demo-s9-b')
    try {
      const pa = makeSent(a)
      const foreign = await confirmClick(b, pa.id, pa.version, {
        buttonId: proposalButtonId(pa.id, pa.version, 'confirm'),
      })
      expect(foreign.status).toBe('ignored')
      if (foreign.status === 'ignored') expect(foreign.reason).toBe('proposal_missing')
      expect(appointmentCount(a)).toBe(0)
      expect(appointmentCount(b)).toBe(0)

      const forged = handleProposalButtonClick(
        a.db,
        {
          tenantId: a.tenantId,
          contactId: a.contact.id,
          conversationId: a.conversation.id,
          buttonId: proposalButtonId('aprop_forjado_llm', 1, 'confirm'),
        },
        a.clock,
      )
      expect(forged.handled).toBe(true)
      if ('ignored' in forged) expect(forged.reason).toBe('proposal_missing')
    } finally {
      a.close()
      b.close()
    }
  })
})

describe('S9: proposta antiga / expirada / não enviada', () => {
  it('proposta expirada (>30 min) não marca', async () => {
    const s = await seedBookable()
    try {
      const proposal = makeSent(s)
      s.clock.advance(APPOINTMENT_PROPOSAL_VALIDITY_MS + 1)
      const auth = evaluateProposalAuthorization(
        s.db,
        {
          tenantId: s.tenantId,
          proposalId: proposal.id,
          contactId: s.contact.id,
          conversationId: s.conversation.id,
        },
        s.clock,
      )
      expect(auth.allowed).toBe(false)
      if (!auth.allowed) expect(auth.reason).toBe('expired')
      const denied = await confirmClick(s, proposal.id, proposal.version)
      expect(denied.status).toBe('denied')
      expect(appointmentCount(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('preparada e envio_incerto não autorizam clique', async () => {
    const s = await seedBookable()
    try {
      const prepared = createProposal(
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
      expect(
        evaluateProposalAuthorization(
          s.db,
          {
            tenantId: s.tenantId,
            proposalId: prepared.id,
            contactId: s.contact.id,
            conversationId: s.conversation.id,
          },
          s.clock,
        ),
      ).toMatchObject({ allowed: false, reason: 'not_enviada' })

      markProposalSendPending(s.db, s.tenantId, prepared.id, s.clock)
      markProposalSendUncertain(s.db, s.tenantId, prepared.id, s.clock)
      const authU = evaluateProposalAuthorization(
        s.db,
        {
          tenantId: s.tenantId,
          proposalId: prepared.id,
          contactId: s.contact.id,
          conversationId: s.conversation.id,
        },
        s.clock,
      )
      expect(authU.allowed).toBe(false)
      if (!authU.allowed) expect(authU.reason).toBe('not_enviada')
      expect(appointmentCount(s)).toBe(0)
    } finally {
      s.close()
    }
  })
})

describe('S9: perda de ack, concorrência e desativação mid-job', () => {
  it('perda de ack / reentrega após book é replay sem segundo compromisso', async () => {
    const s = await seedBookable()
    try {
      const proposal = makeSent(s)
      const first = await confirmClick(s, proposal.id, proposal.version, {
        providerEventKey: 'evt_ack_lost_1',
      })
      expect(first.status).toBe('booked')
      const second = await confirmClick(s, proposal.id, proposal.version, {
        providerEventKey: 'evt_ack_lost_2',
      })
      expect(second.status).toBe('booked')
      if (second.status === 'booked') expect(second.idempotentReplay).toBe(true)
      expect(appointmentCount(s)).toBe(1)
      const audits = listOperationalAudit(s.db, s.tenantId, 50).filter(
        (a) => a.action === 'appointment.ai_booked',
      )
      expect(audits.length).toBeGreaterThanOrEqual(1)
      expect(audits.every((a) => a.actor === AI_AUTOBOOK_ACTOR)).toBe(true)
    } finally {
      s.close()
    }
  })

  it('desativação mid-job: capability off nega efeito novo; não apaga compromisso legítimo', async () => {
    const s = await seedBookable()
    try {
      const proposal = makeSent(s)
      const denied = await confirmClick(s, proposal.id, proposal.version, { capability: false })
      expect(denied.status).toBe('denied')
      if (denied.status === 'denied') expect(denied.reason).toBe('capability_disabled')
      expect(appointmentCount(s)).toBe(0)

      const booked = await confirmClick(s, proposal.id, proposal.version, { capability: true })
      expect(booked.status).toBe('booked')
      const afterKill = await confirmClick(s, proposal.id, proposal.version, {
        capability: false,
        providerEventKey: 'evt_after_kill',
      })
      expect(afterKill.status).toBe('booked')
      if (afterKill.status === 'booked') expect(afterKill.idempotentReplay).toBe(true)
      expect(appointmentCount(s)).toBe(1)
    } finally {
      s.close()
    }
  })
})

describe('S9: falha de envio e pending communication', () => {
  it('falha no resultado booked abre pendência e preserva o compromisso', async () => {
    const s = await seedBookable()
    try {
      const proposal = makeSent(s)
      const booked = await confirmClick(s, proposal.id, proposal.version)
      expect(booked.status).toBe('booked')
      expect(appointmentCount(s)).toBe(1)
      if (booked.status !== 'booked') return

      // O executor já enfileirou o resultado; forçamos falha Meta nesse outbound.
      const resultOutcome = booked.result
      expect(
        resultOutcome.status === 'queued' || resultOutcome.status === 'already_queued',
      ).toBe(true)
      if (resultOutcome.status !== 'queued') {
        // already_queued sem outbound no tipo — localiza pelo clientRequestId estável.
        const outbound = clinicInbox.findOutboundByClientRequestId(
          s.db,
          s.tenantId,
          proposalResultClientRequestId(proposal.id, proposal.version, 'booked'),
        )
        expect(outbound).toBeTruthy()
        if (!outbound) return
        clinicInbox.applyOutboundSendResultOp(
          s.db,
          queueCaller(s.tenantId),
          {
            outboundId: outbound.id,
            outboxEventId: outbound.outboxEventId ?? 'evt_s9_fail',
            idempotencyKey: `whatsapp.send:${outbound.clientRequestId}`,
            outcome: 'failed',
            errorCode: 'meta_send_rejected',
          },
          s.clock,
        )
        reconcileProposalResultOutboundSend(s.db, s.tenantId, outbound, 'failed', s.clock)
      } else {
        const outbound = resultOutcome.outbound
        clinicInbox.applyOutboundSendResultOp(
          s.db,
          queueCaller(s.tenantId),
          {
            outboundId: outbound.id,
            outboxEventId: outbound.outboxEventId ?? 'evt_s9_fail',
            idempotencyKey: `whatsapp.send:${outbound.clientRequestId}`,
            outcome: 'failed',
            errorCode: 'meta_send_rejected',
          },
          s.clock,
        )
        reconcileProposalResultOutboundSend(s.db, s.tenantId, outbound, 'failed', s.clock)
      }
      expect(appointmentCount(s)).toBe(1)
    } finally {
      s.close()
    }
  })

  it('envio da proposta falhado não cria compromisso nem alocação', async () => {
    const s = await seedBookable()
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
      const queued = sendProposalToWhatsAppOp(
        s.db,
        s.caller,
        { proposalId: proposal.id },
        s.clock,
      )
      expect(queued.status === 'queued' || queued.status === 'handed_off_closed_window').toBe(true)
      if (queued.status !== 'queued') return
      clinicInbox.applyOutboundSendResultOp(
        s.db,
        queueCaller(s.tenantId),
        {
          outboundId: queued.outbound.id,
          outboxEventId: queued.outbound.outboxEventId ?? 'evt_prop_fail',
          idempotencyKey: `whatsapp.send:${queued.outbound.clientRequestId}`,
          outcome: 'failed',
          errorCode: 'meta_send_rejected',
        },
        s.clock,
      )
      expect(appointmentCount(s)).toBe(0)
      expect(allocationCount(s)).toBe(0)
    } finally {
      s.close()
    }
  })
})

describe('S9: hibernate/restore sintético (persistência SQLite)', () => {
  it('reabre ficheiro SQLite após book e replay não duplica', async () => {
    const dir = mkdtempSync(join(tmpdir(), 's9-hibernate-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'clinic.sqlite')
    const clock = createControllableClock(T0)
    const tenantId = 'clinic-demo-s9-hibernate'

    const raw1 = new DatabaseSync(dbPath)
    raw1.exec('PRAGMA foreign_keys = ON;')
    const db1 = fromNodeSqlite(raw1)
    runClinicMigrations(db1, clock)
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    clinicWhatsapp.syncWhatsappChannel(
      db1,
      tenantId,
      {
        status: 'connected',
        bindingId: 'bind_s9_h',
        phoneNumberId: 'pn_s9_h',
        wabaId: 'waba_s9_h',
        displayPhone: '+5511999000000',
        displayName: 'Clínica S9 H',
        action: 'channel_connected',
      },
      clock,
    )
    clinicInbox.seedSyntheticWhatsappTemplates(db1, tenantId, clock)
    const pro = upsertResourceOp(db1, caller, { kind: 'professional', name: 'Dra. Paula Reis' }, clock)
    const room = upsertResourceOp(
      db1,
      caller,
      { kind: 'room', name: 'Sala 1', category: 'Padrão' },
      clock,
    )
    const svc = upsertServiceOp(
      db1,
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
    setWeeklyWindowsOp(
      db1,
      caller,
      { resourceId: pro.id, windows: [{ dayOfWeek: 5, startMinute: 9 * 60, endMinute: 18 * 60 }] },
      clock,
    )
    setWeeklyWindowsOp(
      db1,
      caller,
      { resourceId: room.id, windows: [{ dayOfWeek: 5, startMinute: 9 * 60, endMinute: 18 * 60 }] },
      clock,
    )
    setAiProfileOp(db1, caller, { clinicAddress: 'Rua das Flores, 100 — São Paulo' }, clock)
    const contact = upsertContact(
      db1,
      { tenantId, waId: '5511999000920', displayName: 'Ana Silva' },
      clock,
    )
    const conversation = createConversation(
      db1,
      { tenantId, contactId: contact.id, status: 'open' },
      clock,
    )
    insertMessage(
      db1,
      {
        tenantId,
        conversationId: conversation.id,
        direction: 'inbound',
        body: 'Oi',
        externalMessageId: 'wamid.in_s9_h',
        deliveryState: 'received',
        authorClerkUserId: null,
        authorDisplayName: null,
        createdAt: clock.nowMs(),
      },
      clock,
    )
    const startsAt = T0 + 24 * 60 * 60 * 1000
    const proposal = createProposal(
      db1,
      tenantId,
      {
        contactId: contact.id,
        conversationId: conversation.id,
        serviceId: svc.id,
        professionalId: pro.id,
        startsAt,
      },
      clock,
    )
    markProposalSent(db1, tenantId, proposal.id, clock)
    db1.run(
      `UPDATE appointment_proposals SET send_provider_message_id = ? WHERE tenant_id = ? AND id = ?`,
      'wamid.proposal_s9_h',
      tenantId,
      proposal.id,
    )
    const click1 = handleProposalButtonClick(
      db1,
      {
        tenantId,
        contactId: contact.id,
        conversationId: conversation.id,
        buttonId: proposalButtonId(proposal.id, proposal.version, 'confirm'),
        contextMessageId: 'wamid.proposal_s9_h',
        providerEventKey: 'evt_pre_hibernate',
      },
      clock,
    )
    expect(click1.handled).toBe(true)
    if (!('handoff' in click1)) throw new Error('expected handoff')
    const booked = await executeProposalConfirmOp(
      db1,
      caller,
      {
        handoff: click1.handoff,
        capability: true,
        providerEventKey: 'evt_pre_hibernate',
        contextMessageId: 'wamid.proposal_s9_h',
        senderContactId: contact.id,
      },
      clock,
    )
    expect(booked.status).toBe('booked')
    raw1.close()

    // Restore = reopen same SQLite file (hibernação DO).
    const raw2 = new DatabaseSync(dbPath)
    raw2.exec('PRAGMA foreign_keys = ON;')
    const db2 = fromNodeSqlite(raw2)
    expect(
      db2.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`, tenantId)
        ?.n,
    ).toBe(1)
    const click2 = handleProposalButtonClick(
      db2,
      {
        tenantId,
        contactId: contact.id,
        conversationId: conversation.id,
        buttonId: proposalButtonId(proposal.id, proposal.version, 'confirm'),
        contextMessageId: 'wamid.proposal_s9_h',
        providerEventKey: 'evt_post_hibernate',
      },
      clock,
    )
    expect(click2.handled).toBe(true)
    if (!('handoff' in click2)) throw new Error('expected handoff')
    const replay = await executeProposalConfirmOp(
      db2,
      caller,
      {
        handoff: click2.handoff,
        capability: true,
        providerEventKey: 'evt_post_hibernate',
        contextMessageId: 'wamid.proposal_s9_h',
        senderContactId: contact.id,
      },
      clock,
    )
    expect(replay.status).toBe('booked')
    if (replay.status === 'booked') expect(replay.idempotentReplay).toBe(true)
    expect(
      db2.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`, tenantId)
        ?.n,
    ).toBe(1)
    raw2.close()
  })
})

describe('S9: webhook adulterado (ponte para #32)', () => {
  it('assinatura inválida rejeita ingest sem enfileirar', async () => {
    const clock = createControllableClock(T0)
    const queued: unknown[] = []
    let receipts = 0
    const store = {
      resolveTenant: async () => null,
      insertReceipt: async (input: { providerEventKey: string; kind: string }) => {
        receipts += 1
        return {
          row: {
            id: `rcpt_${receipts}`,
            providerEventKey: input.providerEventKey,
            kind: input.kind,
            processingState: 'received',
          },
          duplicate: false,
        }
      },
      markEnqueued: async () => undefined,
    }
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15550001111',
                  phone_number_id: 'pn_unknown_s9',
                },
                contacts: [{ profile: { name: 'X' }, wa_id: '5511999000001' }],
                messages: [
                  {
                    from: '5511999000001',
                    id: 'wamid.s9_tamper',
                    timestamp: '1730000000',
                    type: 'text',
                    text: { body: 'não deve entrar' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })
    const bad = await ingestWhatsappWebhook(
      {
        store: store as never,
        clock,
        queue: {
          send: async (m) => {
            queued.push(m)
          },
        },
        env: { META_MODE: 'synthetic' },
      },
      { rawBody: raw, signatureHeader: 'sha256=deadbeef' },
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toBe('invalid_signature')
    expect(queued).toHaveLength(0)
    expect(receipts).toBe(0)

    const sig = await computeHubSignature256(raw, SYNTHETIC_APP_SECRET)
    const good = await ingestWhatsappWebhook(
      {
        store: store as never,
        clock,
        queue: {
          send: async (m) => {
            queued.push(m)
          },
        },
        env: { META_MODE: 'synthetic' },
      },
      { rawBody: raw, signatureHeader: sig },
    )
    expect(good.ok).toBe(true)
    // Número desconhecido → descartado, sem job na fila.
    expect(queued).toHaveLength(0)
  })
})

describe('S9: zero efeitos não autorizados (síntese)', () => {
  it('compromisso manual legítimo sobrevive a kill switch e clique inválido', async () => {
    const s = await seedBookable()
    try {
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'manual-legit-s9',
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          roomResourceId: s.room.id,
          startsAt: s.startsAt + 2 * 60 * 60 * 1000,
          contactId: s.contact.id,
          actorClerkUserId: 'user_synth_owner_a',
        },
        s.clock,
      )
      expect(appointmentCount(s)).toBe(1)

      const proposal = makeSent(s)
      await confirmClick(s, proposal.id, proposal.version, { capability: false })
      const intruder = upsertContact(
        s.db,
        { tenantId: s.tenantId, waId: '5511999000999', displayName: 'Outra' },
        s.clock,
      )
      await confirmClick(s, proposal.id, proposal.version, { contactId: intruder.id })

      const rows = s.db.all<{ confirmed_by: string }>(
        `SELECT confirmed_by FROM appointments WHERE tenant_id = ? ORDER BY starts_at`,
        s.tenantId,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.confirmed_by).toBe('user_synth_owner_a')
      expect(rows[0]!.confirmed_by).not.toBe(AI_AUTOBOOK_ACTOR)
    } finally {
      s.close()
    }
  })
})
