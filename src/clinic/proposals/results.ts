/**
 * Mensagens determinísticas de resultado após commit (S4 / DEC-061).
 * Sucesso só se anuncia depois do commit; falha de envio → comunicação pendente (H7).
 */
import type { Clock } from '../../db/clock'
import {
  PROPOSAL_RESULT_CLIENT_REQUEST_PREFIX,
  PROPOSAL_SEND_ACTOR,
  PROPOSAL_SEND_ACTOR_DISPLAY,
  type ProposalResultKind,
} from '../constants'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller, workerCaller } from '../envelopes'
import { NotFoundError, ValidationError } from '../errors'
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
  findProposalByResultOutboundId,
  getProposal,
  linkProposalResult,
} from './proposals'
import {
  openPendingCommunication,
  resolvePendingByProposalKind,
} from './pending-communication'
import { proposalResultClientRequestId, renderProposalResultBody } from './render'
import type { AppointmentProposalRow } from './types'

export type SendProposalResultOutcome =
  | {
      status: 'queued'
      proposal: AppointmentProposalRow
      message: MessageRow
      outbound: OutboundMessageRow
      duplicate: boolean
      body: string
      outbox: OutboxRow[]
    }
  | {
      status: 'handed_off_closed_window'
      proposal: AppointmentProposalRow
      systemMessage: MessageRow
      body: string
      outbox: OutboxRow[]
    }
  | {
      status: 'already_queued'
      proposal: AppointmentProposalRow
      outbox: OutboxRow[]
    }

/**
 * Envia o texto fixo de resultado. Nunca inventa sucesso antes do commit —
 * o chamador (S5) só invoca depois de book / slot_refused / pix path.
 */
export function sendProposalResultMessageOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    proposalId: string
    resultKind: ProposalResultKind
  },
  clock: Clock,
): SendProposalResultOutcome {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const proposal = getProposal(db, meta.tenantId, input.proposalId)
  if (!proposal) throw new NotFoundError('proposal_not_found', 'Proposta não encontrada')

  if (proposal.resultOutboundId && proposal.resultKind === input.resultKind) {
    return { status: 'already_queued', proposal, outbox: [] }
  }

  const body = renderProposalResultBody(proposal, input.resultKind)
  const clientRequestId = proposalResultClientRequestId(
    proposal.id,
    proposal.version,
    input.resultKind,
  )
  requireConversation(db, meta.tenantId, proposal.conversationId)
  const window = messagingWindowForConversation(
    db,
    meta.tenantId,
    proposal.conversationId,
    clock.nowMs(),
  )

  if (!window.open) {
    const now = clock.nowMs()
    const systemMessage = insertMessage(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: proposal.conversationId,
        direction: 'system',
        body:
          `Resultado «${input.resultKind}» pronto, mas a janela WhatsApp está fechada. ` +
          `Comunicação pendente — a equipe deve avisar a cliente. Texto: ${body}`,
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
    linkProposalResult(
      db,
      meta.tenantId,
      proposal.id,
      { resultKind: input.resultKind },
      clock,
    )
    openPendingCommunication(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: proposal.conversationId,
        contactId: proposal.contactId,
        proposalId: proposal.id,
        kind: 'result_send',
        messageId: systemMessage.id,
        detailText: `Resultado ${input.resultKind} não enviado (janela fechada)`,
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
        idempotencyKey: `proposal.result.handoff:${proposal.id}:${input.resultKind}`,
        payload: {
          conversationId: proposal.conversationId,
          messageId: systemMessage.id,
          direction: 'system',
          proposalId: proposal.id,
          resultKind: input.resultKind,
        },
      },
      clock,
    )
    return {
      status: 'handed_off_closed_window',
      proposal: getProposal(db, meta.tenantId, proposal.id)!,
      systemMessage,
      body,
      outbox: [outbox],
    }
  }

  let sent
  try {
    sent = sendOutboundMessageOp(
      db,
      caller.actorId ? caller : workerCaller(meta.tenantId, PROPOSAL_SEND_ACTOR),
      {
        conversationId: proposal.conversationId,
        body,
        clientRequestId,
        authorClerkUserId: PROPOSAL_SEND_ACTOR,
        authorDisplayName: PROPOSAL_SEND_ACTOR_DISPLAY,
      },
      clock,
    )
  } catch (err) {
    openPendingCommunication(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: proposal.conversationId,
        contactId: proposal.contactId,
        proposalId: proposal.id,
        kind: 'result_send',
        detailText: err instanceof Error ? err.message.slice(0, 200) : 'falha_resultado',
      },
      clock,
    )
    if (err instanceof ValidationError) throw err
    throw err
  }

  linkProposalResult(
    db,
    meta.tenantId,
    proposal.id,
    {
      resultOutboundId: sent.value.outbound.id,
      resultKind: input.resultKind,
    },
    clock,
  )
  openPendingCommunication(
    db,
    {
      tenantId: meta.tenantId,
      conversationId: proposal.conversationId,
      contactId: proposal.contactId,
      proposalId: proposal.id,
      kind: 'result_send',
      outboundId: sent.value.outbound.id,
      messageId: sent.value.message.id,
      detailText: `Aguardando envio do resultado ${input.resultKind}`,
    },
    clock,
  )

  return {
    status: 'queued',
    proposal: getProposal(db, meta.tenantId, proposal.id)!,
    message: sent.value.message,
    outbound: sent.value.outbound,
    duplicate: sent.value.duplicate,
    body,
    outbox: sent.outbox,
  }
}

export function reconcileProposalResultOutboundSend(
  db: ClinicDb,
  tenantId: string,
  outbound: OutboundMessageRow,
  outcome: 'succeeded' | 'failed' | 'uncertain',
  clock: Clock,
): AppointmentProposalRow | null {
  if (
    !outbound.clientRequestId.startsWith(PROPOSAL_RESULT_CLIENT_REQUEST_PREFIX) &&
    !findProposalByResultOutboundId(db, tenantId, outbound.id)
  ) {
    return null
  }
  const proposal =
    findProposalByResultOutboundId(db, tenantId, outbound.id) ??
    (() => {
      const m = /^proposal\.result:([^:]+):v(\d+):([^:]+)$/.exec(outbound.clientRequestId)
      return m ? getProposal(db, tenantId, m[1]!) : null
    })()
  if (!proposal) return null

  linkProposalResult(
    db,
    tenantId,
    proposal.id,
    { resultOutboundId: outbound.id, resultKind: proposal.resultKind },
    clock,
  )

  if (outcome === 'succeeded') {
    resolvePendingByProposalKind(db, tenantId, proposal.id, 'result_send', clock)
  } else {
    openPendingCommunication(
      db,
      {
        tenantId,
        conversationId: proposal.conversationId,
        contactId: proposal.contactId,
        proposalId: proposal.id,
        kind: 'result_send',
        outboundId: outbound.id,
        messageId: outbound.messageId,
        detailText:
          outcome === 'uncertain'
            ? 'Resultado com envio incerto — sem retry cego'
            : outbound.failureReason ?? 'Falha no envio do resultado',
      },
      clock,
    )
  }
  return getProposal(db, tenantId, proposal.id)
}
