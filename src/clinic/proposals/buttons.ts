/**
 * Costura S4→S5: webhook button_reply → autorização / Alterar detalhes.
 * Confirmar devolve handoff; `executeProposalConfirmOp` (S5 #176) executa book/Pix.
 * Texto digitado igual ao rótulo do botão NÃO chega aqui — só `button_reply`.
 *
 * Alterar detalhes (Paulo «Quero»/«Sim», 09/11/2026): invalida a proposta sem
 * handoff; o Clinic DO abre o menu IA (Horário|Serviço|Variantes).
 * «Falar com a equipe» mantém handoff (DEC-083).
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
  retireActiveProposal,
} from './proposals'
import { cancelAutoDraft } from '../ai/autodraft'
import {
  isHumanTeamOfferAllowed,
  notifyHumanHandoff,
  replyAfterHoursHumanRequest,
} from '../ai/human-handoff'
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
  /** `true` só na cópia `inlineFallback` da fila após commit inline. */
  queueFallbackResume?: boolean
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
      /** false fora do expediente (DEC-155: horário + IA activa). */
      paused: boolean
      outbox: OutboxRow[]
    }
  | {
      handled: true
      action: 'alter'
      proposal: AppointmentProposalRow
      /** Proposta invalidada; Clinic DO abre menu de reoferta IA. */
      reoffer: true
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
 * Processa o clique do botão. Alterar → invalida + reoffer; Confirmar → handoff S5.
 */
export function handleProposalButtonClick(
  db: ClinicDb,
  input: ProposalButtonClickInput,
  clock: Clock,
): ProposalButtonClickResult {
  assertClinicSchemaReady(db)
  const parsed = parseProposalButtonId(input.buttonId)
  if (!parsed) return { handled: false, reason: 'not_proposal_button' }

  // Ingest do button_reply já enfileirou autodraft (`[Botão] Confirmar`).
  // O executor S5/Alterar/equipe é a resposta — sem cancel, o job stale
  // (frame ainda com choose_slot) pode emitir `esclarecer` depois do Agendado.
  cancelAutoDraft(db, input.tenantId, input.conversationId)

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
    const clientRequestId = `proposal.human:${proposal.id}:v${proposal.version}:${input.providerEventKey ?? 'click'}`
    // DEC-155: fora do expediente o toque não pausa — responde com horário e mantém a IA.
    if (!isHumanTeamOfferAllowed(db, input.tenantId, clock)) {
      const afterHours = replyAfterHoursHumanRequest(
        db,
        input.tenantId,
        { conversationId: proposal.conversationId, clientRequestId },
        clock,
      )
      return {
        handled: true,
        action: 'human',
        proposal,
        paused: false,
        outbox: afterHours.outbox,
      }
    }
    const handoff = notifyHumanHandoff(
      db,
      input.tenantId,
      {
        conversationId: proposal.conversationId,
        reason: 'customer_requested',
        clientRequestId,
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
    // Invalida (substituída) — Confirmar na versão antiga não marca. Sem handoff.
    const retired =
      retireActiveProposal(db, input.tenantId, proposal.conversationId, clock) ??
      proposal
    const invalidated =
      getProposal(db, input.tenantId, proposal.id) ?? retired
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
    // Sem alerta à equipe: a IA continua (menu Horário|Serviço|Variantes).
    touchConversationMessage(db, {
      tenantId: input.tenantId,
      conversationId: proposal.conversationId,
      preview: systemMessage.body,
      direction: 'system',
      at: now,
      bumpUnread: false,
      reopenIfClosed: true,
    })
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
          reoffer: true,
        },
      },
      clock,
    )
    return {
      handled: true,
      action: 'alter',
      proposal: invalidated,
      reoffer: true,
      systemMessageId: systemMessage.id,
      outbox: [outbox],
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
