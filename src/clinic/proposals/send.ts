/**
 * Orquestra envio determinístico da proposta por WhatsApp (S4 / #175).
 * preparada → envio_pendente → outbox interactive → enviada | envio_incerto.
 * Janela 24 h fechada → handoff à equipe (sem envio irregular / sem template inventado).
 */
import type { Clock } from '../../db/clock'
import {
  PROPOSAL_SEND_ACTOR,
  PROPOSAL_SEND_ACTOR_DISPLAY,
  PROPOSAL_SEND_CLIENT_REQUEST_PREFIX,
} from '../constants'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller, workerCaller } from '../envelopes'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { insertMessage } from '../inbox/messages'
import { sendOutboundMessageOp } from '../inbox/operations'
import { requireConversation, touchConversationMessage } from '../inbox/conversations'
import { messagingWindowForConversation } from '../inbox/window'
import type { MessageRow } from '../inbox/types'
import type { OutboundMessageRow } from '../inbox/outbound'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import {
  findProposalBySendOutboundId,
  getActiveProposalForConversation,
  getProposal,
  linkProposalSend,
  markProposalSendPending,
  markProposalSendUncertain,
  markProposalSent,
} from './proposals'
import {
  listOpenPendingCommunicationsForConversation,
  openPendingCommunication,
  resolvePendingByProposalKind,
  type PendingCommunicationRow,
} from './pending-communication'
import { proposalSendClientRequestId, renderProposalInteractive } from './render'
import type { AppointmentProposalRow } from './types'

export type SendProposalResult =
  | {
      status: 'queued'
      proposal: AppointmentProposalRow
      message: MessageRow
      outbound: OutboundMessageRow
      duplicate: boolean
      interactive: ReturnType<typeof renderProposalInteractive>
      outbox: OutboxRow[]
    }
  | {
      status: 'handed_off_closed_window'
      proposal: AppointmentProposalRow
      systemMessage: MessageRow
      reason: 'outside_messaging_window'
      outbox: OutboxRow[]
    }
  | {
      status: 'already_sent'
      proposal: AppointmentProposalRow
      outbox: OutboxRow[]
    }

function systemCaller(tenantId: string): ClinicCaller {
  return workerCaller(tenantId, PROPOSAL_SEND_ACTOR)
}

/**
 * Envia a proposta persistida como mensagem interactive (Confirmar / Alterar detalhes).
 * Idempotente por `proposal.send:<id>:v<version>`.
 */
export function sendProposalToWhatsAppOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: { proposalId: string },
  clock: Clock,
): SendProposalResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  const proposal = getProposal(db, meta.tenantId, input.proposalId)
  if (!proposal) throw new NotFoundError('proposal_not_found', 'Proposta não encontrada')

  if (proposal.state === 'enviada' && proposal.sendOutboundId) {
    return { status: 'already_sent', proposal, outbox: [] }
  }
  if (
    proposal.state !== 'preparada' &&
    proposal.state !== 'envio_pendente' &&
    proposal.state !== 'envio_incerto'
  ) {
    throw new ConflictError(
      'proposal_not_sendable',
      `Proposta em estado ${proposal.state} não pode ser enviada`,
      { state: proposal.state },
    )
  }

  requireConversation(db, meta.tenantId, proposal.conversationId)
  const window = messagingWindowForConversation(
    db,
    meta.tenantId,
    proposal.conversationId,
    clock.nowMs(),
  )

  if (!window.open) {
    // AC #175: janela fechada / sem template de proposta aprovado → equipe, sem envio irregular.
    markProposalSendPending(db, meta.tenantId, proposal.id, clock)
    const now = clock.nowMs()
    const systemMessage = insertMessage(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: proposal.conversationId,
        direction: 'system',
        body:
          'Proposta pronta, mas a janela de 24 h do WhatsApp está fechada. ' +
          'Não há modelo aprovado para envio com botões — a equipe deve retomar o contacto ' +
          '(sem envio irregular). Validação Meta em staging: Em aberto.',
        externalMessageId: null,
        deliveryState: 'received',
        authorClerkUserId: PROPOSAL_SEND_ACTOR,
        authorDisplayName: PROPOSAL_SEND_ACTOR_DISPLAY,
        createdAt: now,
      },
      clock,
    )
    touchConversationMessage(db, {
      tenantId: meta.tenantId,
      conversationId: proposal.conversationId,
      preview: systemMessage.body,
      direction: 'system',
      at: now,
      bumpUnread: true,
      reopenIfClosed: true,
    })
    openPendingCommunication(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: proposal.conversationId,
        contactId: proposal.contactId,
        proposalId: proposal.id,
        kind: 'proposal_send',
        messageId: systemMessage.id,
        detailText: 'Janela WhatsApp fechada — proposta não enviada',
      },
      clock,
    )
    const outbox = insertOutboxEvent(
      db,
      {
        tenantId: meta.tenantId,
        type: 'message.created',
        aggregateType: 'message',
        aggregateId: systemMessage.id,
        idempotencyKey: `proposal.send.handoff:${proposal.id}:v${proposal.version}`,
        payload: {
          conversationId: proposal.conversationId,
          messageId: systemMessage.id,
          direction: 'system',
          reason: 'outside_messaging_window',
          proposalId: proposal.id,
          proposalVersion: proposal.version,
        },
      },
      clock,
    )
    return {
      status: 'handed_off_closed_window',
      proposal: getProposal(db, meta.tenantId, proposal.id)!,
      systemMessage,
      reason: 'outside_messaging_window',
      outbox: [outbox],
    }
  }

  const interactive = renderProposalInteractive(proposal, db)
  const clientRequestId = proposalSendClientRequestId(proposal.id, proposal.version)
  markProposalSendPending(db, meta.tenantId, proposal.id, clock)

  const sendCaller = caller.actorId ? caller : systemCaller(meta.tenantId)
  let sent
  try {
    sent = sendOutboundMessageOp(
      db,
      sendCaller,
      {
        conversationId: proposal.conversationId,
        body: interactive.body,
        interactive: {
          buttons: interactive.buttons.map((b) => ({ id: b.id, title: b.title })),
        },
        clientRequestId,
        authorClerkUserId: PROPOSAL_SEND_ACTOR,
        authorDisplayName: PROPOSAL_SEND_ACTOR_DISPLAY,
      },
      clock,
    )
  } catch (err) {
    if (err instanceof ValidationError && err.code === 'outside_messaging_window') {
      // Corrida: janela fechou entre o check e o send.
      return sendProposalToWhatsAppOp(db, caller, input, clock)
    }
    openPendingCommunication(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: proposal.conversationId,
        contactId: proposal.contactId,
        proposalId: proposal.id,
        kind: 'proposal_send',
        detailText: err instanceof Error ? err.message.slice(0, 200) : 'falha_ao_enfileirar',
      },
      clock,
    )
    throw err
  }

  linkProposalSend(
    db,
    meta.tenantId,
    proposal.id,
    {
      sendOutboundId: sent.value.outbound.id,
      sendMessageId: sent.value.message.id,
    },
    clock,
  )

  // Enquanto o Meta não confirma, comunicação pode ficar pendente (H7).
  openPendingCommunication(
    db,
    {
      tenantId: meta.tenantId,
      conversationId: proposal.conversationId,
      contactId: proposal.contactId,
      proposalId: proposal.id,
      kind: 'proposal_send',
      outboundId: sent.value.outbound.id,
      messageId: sent.value.message.id,
      detailText: 'Aguardando aceitação Meta da proposta',
    },
    clock,
  )

  return {
    status: 'queued',
    proposal: getProposal(db, meta.tenantId, proposal.id)!,
    message: sent.value.message,
    outbound: sent.value.outbound,
    duplicate: sent.value.duplicate,
    interactive,
    outbox: sent.outbox,
  }
}

/**
 * Reconcilia resultado Meta do envio da proposta (chamado a partir de applyOutboundSendResult).
 * succeeded → enviada + provider message id; uncertain → envio_incerto; failed → pendente H7.
 */
export function reconcileProposalOutboundSend(
  db: ClinicDb,
  tenantId: string,
  outbound: OutboundMessageRow,
  outcome: 'succeeded' | 'failed' | 'uncertain',
  clock: Clock,
): AppointmentProposalRow | null {
  if (!outbound.clientRequestId.startsWith(PROPOSAL_SEND_CLIENT_REQUEST_PREFIX)) {
    return findProposalBySendOutboundId(db, tenantId, outbound.id)
      ? reconcileByOutbound(db, tenantId, outbound, outcome, clock)
      : null
  }
  return reconcileByOutbound(db, tenantId, outbound, outcome, clock)
}

function reconcileByOutbound(
  db: ClinicDb,
  tenantId: string,
  outbound: OutboundMessageRow,
  outcome: 'succeeded' | 'failed' | 'uncertain',
  clock: Clock,
): AppointmentProposalRow | null {
  let proposal =
    findProposalBySendOutboundId(db, tenantId, outbound.id) ??
    (() => {
      const m = /^proposal\.send:([^:]+):v(\d+)$/.exec(outbound.clientRequestId)
      return m ? getProposal(db, tenantId, m[1]!) : null
    })()
  if (!proposal) return null

  linkProposalSend(
    db,
    tenantId,
    proposal.id,
    {
      sendOutboundId: outbound.id,
      sendMessageId: outbound.messageId,
      sendProviderMessageId: outbound.providerMessageId,
    },
    clock,
  )

  if (outcome === 'succeeded') {
    proposal = markProposalSent(db, tenantId, proposal.id, clock)
    resolvePendingByProposalKind(db, tenantId, proposal.id, 'proposal_send', clock)
    return proposal
  }

  if (outcome === 'uncertain') {
    proposal = markProposalSendUncertain(db, tenantId, proposal.id, clock)
    openPendingCommunication(
      db,
      {
        tenantId,
        conversationId: proposal.conversationId,
        contactId: proposal.contactId,
        proposalId: proposal.id,
        kind: 'proposal_send',
        outboundId: outbound.id,
        messageId: outbound.messageId,
        detailText: 'Envio da proposta com resultado incerto — sem retry cego',
      },
      clock,
    )
    return proposal
  }

  // failed — permanece envio_pendente (ou incerto); não marca enviada; alerta H7.
  openPendingCommunication(
    db,
    {
      tenantId,
      conversationId: proposal.conversationId,
      contactId: proposal.contactId,
      proposalId: proposal.id,
      kind: 'proposal_send',
      outboundId: outbound.id,
      messageId: outbound.messageId,
      detailText: outbound.failureReason ?? 'Falha no envio da proposta',
    },
    clock,
  )
  return getProposal(db, tenantId, proposal.id)
}

/** Lista proposta ativa + pendentes para o painel (membros autorizados via caller). */
export function getConversationProposalPanelView(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): {
  activeProposal: AppointmentProposalRow | null
  pendingCommunications: PendingCommunicationRow[]
} {
  void clock
  return {
    activeProposal: getActiveProposalForConversation(db, tenantId, conversationId, clock),
    pendingCommunications: listOpenPendingCommunicationsForConversation(
      db,
      tenantId,
      conversationId,
    ),
  }
}
