/**
 * S4 (#175): envio interactive da proposta, resultados determinísticos, H7, botões.
 * Dados fictícios; Meta sintético; sem AI_AUTOBOOK nem envio real.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import {
  CLINIC_SCHEMA_VERSION,
  PENDING_COMMUNICATION_ALERT_MS,
  PROPOSAL_SEND_CLIENT_REQUEST_PREFIX,
} from '../constants'
import {
  setAiProfileOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { upsertContact } from '../contacts'
import { queueCaller, workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { clinicInbox } from '../index'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import {
  createProposal,
  evaluateProposalAuthorization,
  getProposal,
  handleProposalButtonClick,
  markProposalConfirmed,
  markProposalSent,
  parseProposalButtonId,
  proposalButtonId,
  renderProposalInteractive,
  sendProposalResultMessageOp,
  sendProposalToWhatsAppOp,
  sweepPendingCommunicationAlerts,
  reconcileProposalOutboundSend,
  reconcileProposalResultOutboundSend,
} from './index'
import { parseWhatsappWebhookPayload } from '../../whatsapp/webhook-parse'

const T0 = Date.UTC(2026, 9, 29, 15, 0)

function seed(tenantId = 'clinic-demo-s4-a') {
  const clock = createControllableClock(T0)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_s4',
      phoneNumberId: 'pn_s4',
      wabaId: 'waba_s4',
      displayPhone: '+5511999000000',
      displayName: 'Clínica S4',
      action: 'channel_connected',
    },
    clock,
  )
  clinicInbox.seedSyntheticWhatsappTemplates(db, tenantId, clock)
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
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
  setAiProfileOp(db, caller, { clinicAddress: 'Rua das Flores, 100 — São Paulo' }, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511999000202', displayName: 'Ana Silva' },
    clock,
  )
  const conversation = createConversation(
    db,
    { tenantId, contactId: contact.id, status: 'open' },
    clock,
  )
  // Abre janela 24 h.
  insertMessage(
    db,
    {
      tenantId,
      conversationId: conversation.id,
      direction: 'inbound',
      body: 'Oi, quero horário',
      externalMessageId: 'wamid.in_s4_1',
      deliveryState: 'received',
      authorClerkUserId: null,
      authorDisplayName: null,
      createdAt: clock.nowMs(),
    },
    clock,
  )
  const startsAt = T0 + 24 * 60 * 60 * 1000
  return { ...boot, clock, caller, tenantId, pro, svc, contact, conversation, startsAt }
}

/** Simula aceitação Meta sem Graph — aplica resultado + reconcile S4. */
function simulateMetaAccepted(
  db: ReturnType<typeof bootClinicDb>['db'],
  tenantId: string,
  clock: ReturnType<typeof createControllableClock>,
  clientRequestId: string,
) {
  const outbound = clinicInbox.findOutboundByClientRequestId(db, tenantId, clientRequestId)
  if (!outbound?.outboxEventId) throw new Error('outbound_missing')
  clinicInbox.applyOutboundSendResultOp(
    db,
    queueCaller(tenantId),
    {
      outboundId: outbound.id,
      outboxEventId: outbound.outboxEventId,
      idempotencyKey: `whatsapp.send:${clientRequestId}`,
      outcome: 'succeeded',
      providerMessageId: `wamid.synth_${clientRequestId.slice(-12)}`,
    },
    clock,
  )
  const fresh = clinicInbox.findOutboundByClientRequestId(db, tenantId, clientRequestId)!
  reconcileProposalOutboundSend(db, tenantId, fresh, 'succeeded', clock)
  reconcileProposalResultOutboundSend(db, tenantId, fresh, 'succeeded', clock)
}

describe('S4: schema', () => {
  it('migração 29 sobe CLINIC_SCHEMA_VERSION e cria pending_communications', () => {
    const { db, close } = bootClinicDb()
    try {
      expect(CLINIC_SCHEMA_VERSION).toBeGreaterThanOrEqual(29)
      const state = db.get<{ version: number; status: string }>(
        'SELECT version, status FROM clinic_schema_state WHERE id = 1',
      )
      expect(state).toEqual({ version: CLINIC_SCHEMA_VERSION, status: 'ready' })
      const kind = db.get<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='outbound_messages'`,
      )
      expect(kind?.sql).toContain('interactive')
      const pending = db.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='pending_communications'`,
      )
      expect(pending?.name).toBe('pending_communications')
    } finally {
      close()
    }
  })
})

describe('S4: render determinístico', () => {
  it('corpo e botões vêm do snapshot; ids amarram versão', () => {
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
      const rendered = renderProposalInteractive(proposal)
      expect(rendered.body).toContain('Limpeza de pele')
      expect(rendered.body).toContain('Rua das Flores')
      expect(rendered.body).toContain('Ana Silva')
      expect(rendered.body).not.toMatch(/LLM|sugestão livre/i)
      expect(rendered.buttons).toHaveLength(3)
      expect(rendered.buttons[2]!.title).toBe('Falar com a equipe')
      expect(rendered.buttons[0]!.title).toBe('Confirmar')
      expect(rendered.buttons[1]!.title).toBe('Alterar detalhes')
      expect(rendered.buttons[0]!.id).toBe(proposalButtonId(proposal.id, 1, 'confirm'))
      expect(parseProposalButtonId(rendered.buttons[1]!.id)).toEqual({
        proposalId: proposal.id,
        version: 1,
        action: 'alter',
      })
    } finally {
      s.close()
    }
  })
})

describe('S4: envio WhatsApp', () => {
  it('enfileira interactive, marca enviada após Meta e regista provider message id', async () => {
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
      const queued = sendProposalToWhatsAppOp(
        s.db,
        s.caller,
        { proposalId: proposal.id },
        s.clock,
      )
      expect(queued.status).toBe('queued')
      if (queued.status !== 'queued') return
      expect(queued.outbound.kind).toBe('interactive')
      expect(queued.outbound.clientRequestId.startsWith(PROPOSAL_SEND_CLIENT_REQUEST_PREFIX)).toBe(
        true,
      )
      expect(queued.outbound.interactiveButtons).toHaveLength(3)
      expect(getProposal(s.db, s.tenantId, proposal.id)?.state).toBe('envio_pendente')

      simulateMetaAccepted(s.db, s.tenantId, s.clock, queued.outbound.clientRequestId)
      const sent = getProposal(s.db, s.tenantId, proposal.id)!
      expect(sent.state).toBe('enviada')
      expect(sent.sendOutboundId).toBe(queued.outbound.id)
      expect(sent.sendProviderMessageId).toMatch(/^wamid\./)
      expect(sent.expiresAt).toBe(s.clock.nowMs() + 30 * 60 * 1000)

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
      expect(auth.allowed).toBe(true)
    } finally {
      s.close()
    }
  })

  it('janela fechada → handoff à equipe sem envio irregular', () => {
    const s = seed()
    try {
      // Fecha a janela avançando o relógio > 24 h sem novo inbound.
      s.clock.advance(25 * 60 * 60 * 1000)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          startsAt: s.clock.nowMs() + 48 * 60 * 60 * 1000,
        },
        s.clock,
      )
      const result = sendProposalToWhatsAppOp(
        s.db,
        s.caller,
        { proposalId: proposal.id },
        s.clock,
      )
      expect(result.status).toBe('handed_off_closed_window')
      if (result.status !== 'handed_off_closed_window') return
      expect(result.systemMessage.body).toMatch(/janela/i)
      const sends = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM outbound_messages WHERE tenant_id = ? AND kind = 'interactive'`,
        s.tenantId,
      )
      expect(sends?.n).toBe(0)
      const pending = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM pending_communications
         WHERE tenant_id = ? AND proposal_id = ? AND kind = 'proposal_send' AND status = 'open'`,
        s.tenantId,
        proposal.id,
      )
      expect(pending?.n).toBe(1)
    } finally {
      s.close()
    }
  })

  it('clientRequestId idempotente não duplica outbound', () => {
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
      const a = sendProposalToWhatsAppOp(s.db, s.caller, { proposalId: proposal.id }, s.clock)
      const b = sendProposalToWhatsAppOp(s.db, s.caller, { proposalId: proposal.id }, s.clock)
      expect(a.status).toBe('queued')
      expect(b.status).toBe('queued')
      if (a.status !== 'queued' || b.status !== 'queued') return
      expect(b.duplicate).toBe(true)
      expect(b.outbound.id).toBe(a.outbound.id)
      const n = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM outbound_messages WHERE tenant_id = ?`,
        s.tenantId,
      )
      expect(n?.n).toBe(1)
    } finally {
      s.close()
    }
  })
})

describe('S4: botões e resultado', () => {
  it('Alterar detalhes invalida proposta sem cancelar compromisso', () => {
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
      // Simula enviada.
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      const click = handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          buttonId: proposalButtonId(proposal.id, 1, 'alter'),
          buttonTitle: 'Alterar detalhes',
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      if (!('action' in click) || click.action !== 'alter' || !('forwarded' in click)) return
      expect(click.cancelledExistingAppointment).toBe(false)
      expect(click.proposal.state).toBe('encaminhada')
      const appts = s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)
      expect(appts?.n).toBe(0)
      const sys = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'system' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(sys?.body).toMatch(/alterar a proposta/i)
    } finally {
      s.close()
    }
  })

  it('Confirmar só devolve handoff (book/Pix ficam em executeProposalConfirmOp)', () => {
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
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      const click = handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          buttonId: proposalButtonId(proposal.id, 1, 'confirm'),
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      if (!('action' in click) || click.action !== 'confirm' || !('handoff' in click)) return
      expect(click.handoff.s5Todo).toBe('confirmAppointment_or_pix_signal')
      expect(click.handoff.authorization.allowed).toBe(true)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(0)
    } finally {
      s.close()
    }
  })

  it('resultado booked só após confirmada; falha deixa pendente', async () => {
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
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      markProposalConfirmed(s.db, s.tenantId, proposal.id, s.clock, 'appt_fake_s4')
      const result = sendProposalResultMessageOp(
        s.db,
        s.caller,
        { proposalId: proposal.id, resultKind: 'booked' },
        s.clock,
      )
      expect(result.status).toBe('queued')
      if (result.status !== 'queued') return
      expect(result.body).toMatch(/^Agendado:/)

      // Força falha no Meta — aplicamos failed + reconcile (sem retry cego).
      clinicInbox.applyOutboundSendResultOp(
        s.db,
        queueCaller(s.tenantId),
        {
          outboundId: result.outbound.id,
          outboxEventId: result.outbound.outboxEventId ?? 'evt_fail',
          idempotencyKey: `whatsapp.send:${result.outbound.clientRequestId}`,
          outcome: 'failed',
          errorCode: 'meta_send_rejected',
        },
        s.clock,
      )
      reconcileProposalResultOutboundSend(
        s.db,
        s.tenantId,
        result.outbound,
        'failed',
        s.clock,
      )
      const pending = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM pending_communications
         WHERE tenant_id = ? AND proposal_id = ? AND kind = 'result_send' AND status IN ('open','alerted')`,
        s.tenantId,
        proposal.id,
      )
      expect(pending?.n).toBeGreaterThan(0)
    } finally {
      s.close()
    }
  })
})

describe('S4: H7 alerta 5 min', () => {
  it('sweep marca alerted após PENDING_COMMUNICATION_ALERT_MS', () => {
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
      s.clock.advance(25 * 60 * 60 * 1000)
      sendProposalToWhatsAppOp(s.db, s.caller, { proposalId: proposal.id }, s.clock)
      expect(sweepPendingCommunicationAlerts(s.db, s.tenantId, s.clock)).toHaveLength(0)
      s.clock.advance(PENDING_COMMUNICATION_ALERT_MS + 1)
      const alerted = sweepPendingCommunicationAlerts(s.db, s.tenantId, s.clock)
      expect(alerted.length).toBeGreaterThan(0)
      expect(alerted[0]!.status).toBe('alerted')
    } finally {
      s.close()
    }
  })
})

describe('S4: webhook button_reply', () => {
  it('parseia interactive.button_reply da Cloud API', () => {
    const parsed = parseWhatsappWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'pn_s4' },
                contacts: [{ wa_id: '5511999000202', profile: { name: 'Ana' } }],
                messages: [
                  {
                    id: 'wamid.btn1',
                    from: '5511999000202',
                    timestamp: '1730000000',
                    type: 'interactive',
                    interactive: {
                      type: 'button_reply',
                      button_reply: {
                        id: 'prop:aprop_x:v1:confirm',
                        title: 'Confirmar',
                      },
                    },
                    context: { id: 'wamid.proposal' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })
    expect(parsed.items).toHaveLength(1)
    const item = parsed.items[0]!
    expect(item.kind).toBe('button_reply')
    if (item.kind !== 'button_reply') return
    expect(item.buttonId).toBe('prop:aprop_x:v1:confirm')
    expect(item.buttonTitle).toBe('Confirmar')
    expect(item.contextMessageId).toBe('wamid.proposal')
  })
})
