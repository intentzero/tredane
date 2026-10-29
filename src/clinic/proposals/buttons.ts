/**
 * Costura S4→S5: webhook button_reply → autorização / Alterar detalhes.
 * Confirmar NÃO executa book/Pix aqui — S5 (#176) possui essa responsabilidade.
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
 * S5 deve consumir este resultado quando `action === 'confirm'` e `authorization.allowed`.
 * Não chamar confirmAppointment daqui.
 */
export type ProposalConfirmHandoff = {
  action: 'confirm'
  authorization: ProposalAuthorizationResult
  proposal: AppointmentProposalRow | null
  /**
   * Placeholder estável para S5:
   * - se allowed → executar book / Pix com idempotência por proposalId+version
   * - se denied → enviar resultado expired/slot conforme reason (via sendProposalResultMessageOp)
   */
  s5Todo: 'confirmAppointment_or_pix_signal'
}

export type ProposalButtonClickResult =
  | {
      handled: false
      reason: 'not_proposal_button'
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
    return {
      handled: true,
      action: 'alter',
      proposal: forwarded,
      forwarded: true,
      systemMessageId: systemMessage.id,
      outbox: [outbox],
      cancelledExistingAppointment: false,
    }
  }

  // confirm — só autoriza; S5 executa.
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

  // Opcional: se context.message aponta para outra mensagem, ainda avaliamos pelo id do botão
  // (versão amarrada). S5 pode reforçar o vínculo com send_provider_message_id.
  void input.contextMessageId
  void input.buttonTitle

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
