import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import {
  findOpenOpportunityForConversation,
  insertStageHistory,
  updateOpportunityStage,
} from './opportunities'

/**
 * DEC-061: a etapa sai de «Novo contato» sozinha quando alguém assume a conversa
 * ou envia a primeira resposta. Só avança a partir de `novo_contato`: nunca
 * retrocede nem sobrepõe «Horário proposto», «Agendado» ou etapas terminais, e
 * não mexe em compromisso (DEC-040). Conversa sem oportunidade aberta fica como está.
 * Deve ser chamada dentro da transação da operação que a dispara.
 */
export function advanceToInServiceIfNew(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    actorClerkUserId: string
    actorDisplayName: string
    now: number
    reason: 'assumed' | 'first_reply'
  },
  clock: Clock,
): OutboxRow | null {
  const opp = findOpenOpportunityForConversation(db, input.tenantId, input.conversationId)
  if (!opp || opp.stage !== 'novo_contato') return null

  updateOpportunityStage(db, {
    tenantId: input.tenantId,
    opportunityId: opp.id,
    stage: 'em_atendimento',
    status: 'open',
    updatedAt: input.now,
    lastInteractionAt: input.now,
  })

  insertStageHistory(
    db,
    {
      tenantId: input.tenantId,
      opportunityId: opp.id,
      fromStage: 'novo_contato',
      toStage: 'em_atendimento',
      actorClerkUserId: input.actorClerkUserId,
      actorDisplayName: input.actorDisplayName,
      note:
        input.reason === 'assumed'
          ? 'Automática: assumiu a conversa'
          : 'Automática: primeira resposta',
      createdAt: input.now,
    },
    clock,
  )

  writeOperationalAudit(
    db,
    {
      tenantId: input.tenantId,
      actor: input.actorClerkUserId,
      action: 'opportunity.stage_moved',
      objectType: 'opportunity',
      objectId: opp.id,
      detail: {
        fromStage: 'novo_contato',
        toStage: 'em_atendimento',
        automatic: true,
        reason: input.reason,
        linkedAppointmentId: opp.linkedAppointmentId,
        appointmentUnchanged: true,
      },
    },
    clock,
  )

  return insertOutboxEvent(
    db,
    {
      tenantId: input.tenantId,
      type: 'opportunity.stage_changed',
      aggregateType: 'opportunity',
      aggregateId: opp.id,
      idempotencyKey: `opportunity.stage_changed:${opp.id}:${input.now}`,
      payload: {
        opportunityId: opp.id,
        conversationId: opp.conversationId,
        contactId: opp.contactId,
        fromStage: 'novo_contato',
        toStage: 'em_atendimento',
        status: 'open',
        actorClerkUserId: input.actorClerkUserId,
        linkedAppointmentId: opp.linkedAppointmentId,
        missingAppointment: false,
        automatic: true,
      },
    },
    clock,
  )
}
