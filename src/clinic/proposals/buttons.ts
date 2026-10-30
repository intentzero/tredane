/**
 * Costura S4→S5: webhook button_reply → autorização / Alterar detalhes.
 * Confirmar devolve handoff; `executeProposalConfirmOp` (S5 #176) executa book/Pix.
 * Texto digitado igual ao rótulo do botão NÃO chega aqui — só `button_reply`.
 */
import type { Clock } from '../../db/clock'
import {
  PROPOSAL_SEND_ACTOR,
  PROPOSAL_SEND_ACTOR_DISPLAY,
} from '../constants'
import { insertMessage } from '../inbox/messages'
import { touchConversationMessage } from '../inbox/conversations'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import {
  evaluateProposalAuthorization,
  getProposal,
  markProposalForwarded,
} from './proposals'
import { openPendingCommunication } from './pending-communication'
import { parseProposalButtonId, type ProposalButtonAction } from './render'
import { notifyHumanHandoff } from '../ai/human-handoff'
import type {
  AppointmentProposalRow,
  ProposalAuthorizationResult,
} from './types'

export type ProposalButtonClickInput = {
  tenantId: string
  contactId: string
  conversationId: string
  /** reply.id da Cloud API. */
  buttonId: string
  buttonTitle?: string | null
  /** context.id da mensagem da proposta (opcional). */
  contextMessageId?: string | null
  providerEventKey?: string | null
}

/**
 * Handoff para `executeProposalConfirmOp` quando `action === 'confirm'`.
 * Book/Pix ficam no executor (idempotente por proposalId+version).
 */
export type ProposalConfirmHandoff = {
  action: 'confirm'
  authorization: ProposalAuthorizationResult
  proposal: AppointmentProposalRow | null
  /** Contrato S4→S5: o DO/executor trata book ou Pix. */
  s5Todo: 'confirmAppointment_or_pix_signal'
}

export type ProposalButtonClickResult =
  | {
      handled: false
      reason: 'not_proposal_button'
    }
  | {
      handled: true
      action: 'human'
      proposal: AppointmentProposalRow
      paused: true
      outbox: OutboxRow[]
    }
  | {
      handled: true
      action: 'alter'
      proposal: AppointmentProposalRow
      forwarded: true
      systemMessageId: string
      outbox: OutboxRow[]
      /** Alterar detalhes invalida a proposta; não cancela compromisso existente. */
      cancelledExistingAppointment: false
    }
  | {
      handled: true
      action: 'confirm'
      handoff: ProposalConfirmHandoff
      outbox: OutboxRow[]
    }
  | {
      handled: true
      action: ProposalButtonAction
      ignored: true
      reason: 'version_mismatch' | 'proposal_missing'
      proposal: AppointmentProposalRow | null
      outbox: OutboxRow[]
    }

/**
 * Processa o clique do botão. Alterar → encaminha; Confirmar → devolve handoff S5.
 */
export function handleProposalButtonClick(
  db: ClinicDb,
  input: ProposalButtonClickInput,
  clock: Clock,
): ProposalButtonClickResult {
  assertClinicSchemaReady(db)
  const parsed = parseProposalButtonId(input.buttonId)
  if (!parsed) return { handled: false, reason: 'not_proposal_button' }

  const proposal = getProposal(db, input.tenantId, parsed.proposalId)
  if (!proposal) {
    return {
      handled: true,
      action: parsed.action,
      ignored: true,
      reason: 'proposal_missing',
      proposal: null,
      outbox: [],
    }
  }
  if (proposal.version !== parsed.version) {
    return {
      handled: true,
      action: parsed.action,
      ignored: true,
      reason: 'version_mismatch',
      proposal,
      outbox: [],
    }
  }

  if (parsed.action === 'human') {
    const handoff = notifyHumanHandoff(
      db,
      input.tenantId,
      {
        conversationId: proposal.conversationId,
        reason: 'customer_requested',
        clientRequestId: `proposal.human:${proposal.id}:v${proposal.version}:${input.providerEventKey ?? 'click'}`,
      },
      clock,
    )
    return {
      handled: true,
      action: 'human',
      proposal,
      paused: true,
      outbox: handoff.outbox,
    }
  }

  if (parsed.action === 'alter') {
    const forwarded = markProposalForwarded(db, input.tenantId, proposal.id, clock)
    const now = clock.nowMs()
    const systemMessage = insertMessage(
      db,
      {
        tenantId: input.tenantId,
        conversationId: proposal.conversationId,
        direction: 'system',
        body: 'Cliente pediu para alterar a proposta',
        externalMessageId: null,
        deliveryState: 'received',
        authorClerkUserId: PROPOSAL_SEND_ACTOR,
        authorDisplayName: PROPOSAL_SEND_ACTOR_DISPLAY,
        createdAt: now,
      },
      clock,
    )
    touchConversationMessage(db, {
      tenantId: input.tenantId,
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
        tenantId: input.tenantId,
        conversationId: proposal.conversationId,
        contactId: proposal.contactId,
        proposalId: proposal.id,
        kind: 'alter_awaiting_team',
        messageId: systemMessage.id,
        detailText: 'Aguardando resposta da equipe após Alterar detalhes',
      },
      clock,
    )
    const outbox = insertOutboxEvent(
      db,
      {
        tenantId: input.tenantId,
        type: 'message.created',
        aggregateType: 'message',
        aggregateId: systemMessage.id,
        idempotencyKey: `proposal.alter:${proposal.id}:v${proposal.version}:${input.providerEventKey ?? systemMessage.id}`,
        payload: {
          conversationId: proposal.conversationId,
          messageId: systemMessage.id,
          direction: 'system',
          proposalId: proposal.id,
          proposalVersion: proposal.version,
          action: 'alter',
        },
      },
      clock,
    )
    const handoff = notifyHumanHandoff(
      db,
      input.tenantId,
      {
        conversationId: proposal.conversationId,
        reason: 'customer_requested',
        clientRequestId: `proposal.alter:${proposal.id}:v${proposal.version}:${input.providerEventKey ?? 'click'}`,
      },
      clock,
    )
    return {
      handled: true,
      action: 'alter',
      proposal: forwarded,
      forwarded: true,
      systemMessageId: systemMessage.id,
      outbox: [outbox, ...handoff.outbox],
      cancelledExistingAppointment: false,
    }
  }

  // confirm — autoriza; executor S5 faz book/Pix.
  // Título digitado (buttonTitle) não autoriza — só o id opaco do botão.
  void input.buttonTitle

  const authorization = evaluateProposalAuthorization(
    db,
    {
      tenantId: input.tenantId,
      proposalId: proposal.id,
      contactId: input.contactId,
      conversationId: input.conversationId,
    },
    clock,
  )

  // Se Meta enviou context.id e a proposta tem send_provider_message_id, amarrar.
  // Divergência → autorização negada no executor (context_mismatch); aqui só devolve handoff.
  return {
    handled: true,
    action: 'confirm',
    handoff: {
      action: 'confirm',
      authorization,
      proposal: authorization.proposal,
      s5Todo: 'confirmAppointment_or_pix_signal',
    },
    outbox: [],
  }
}
