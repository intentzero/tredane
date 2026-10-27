import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import { requireConversation } from '../inbox/conversations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import {
  findOpenOpportunityForConversation,
  getOpportunityDetail,
  insertOpportunity,
  insertStageHistory,
  isOpportunityStage,
  isTerminalStage,
  listOpportunities,
  loadLinkedAppointment,
  maxCycleForConversation,
  requireOpportunity,
  setLinkedAppointment,
  touchLastInteraction,
  updateOpportunityStage,
} from './opportunities'
import type {
  LinkAppointmentInput,
  ListOpportunitiesInput,
  MoveStageInput,
  OpportunityDetail,
  OpportunityListItem,
  ReopenOpportunityInput,
  StageCount,
} from './types'

export type PipelineMutationResult<T> = {
  value: T
  outbox: OutboxRow[]
}

function requireActor(caller: ClinicCaller): string {
  if (!caller.actorId) {
    throw new ValidationError('actor_required', 'Actor obrigatório para esta operação')
  }
  return caller.actorId
}

/**
 * Garante oportunidade open para a conversa (AC-04 / VAL-02 hipótese).
 * Idempotente: se já existe open, devolve-a; senão cria ciclo 1 em Novo contato.
 */
export function ensureOpenOpportunity(
  db: ClinicDb,
  input: {
    tenantId: string
    contactId: string
    conversationId: string
    assigneeClerkUserId?: string | null
    assigneeDisplayName?: string | null
    lastInteractionAt?: number | null
  },
  clock: Clock,
): { opportunity: OpportunityListItem; created: boolean; outbox: OutboxRow[] } {
  assertClinicSchemaReady(db)
  const existing = findOpenOpportunityForConversation(
    db,
    input.tenantId,
    input.conversationId,
  )
  if (existing) {
    if (input.lastInteractionAt != null) {
      touchLastInteraction(db, input.tenantId, existing.id, input.lastInteractionAt)
    }
    return {
      opportunity: getOpportunityDetail(db, input.tenantId, existing.id),
      created: false,
      outbox: [],
    }
  }

  const cycle = maxCycleForConversation(db, input.tenantId, input.conversationId) + 1
  const opp = insertOpportunity(
    db,
    {
      tenantId: input.tenantId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      stage: 'novo_contato',
      cycleNumber: cycle <= 0 ? 1 : cycle,
      assigneeClerkUserId: input.assigneeClerkUserId ?? null,
      assigneeDisplayName: input.assigneeDisplayName ?? null,
      lastInteractionAt: input.lastInteractionAt ?? clock.nowMs(),
    },
    clock,
  )
  insertStageHistory(
    db,
    {
      tenantId: input.tenantId,
      opportunityId: opp.id,
      fromStage: null,
      toStage: 'novo_contato',
      note: cycle > 1 ? 'Reabertura de ciclo (VAL-02 hipótese)' : 'Criação inicial',
    },
    clock,
  )
  const outbox = insertOutboxEvent(
    db,
    {
      tenantId: input.tenantId,
      type: 'opportunity.created',
      aggregateType: 'opportunity',
      aggregateId: opp.id,
      idempotencyKey: `opportunity.created:${opp.id}`,
      payload: {
        opportunityId: opp.id,
        conversationId: input.conversationId,
        contactId: input.contactId,
        stage: opp.stage,
        cycleNumber: opp.cycleNumber,
      },
    },
    clock,
  )
  return {
    opportunity: getOpportunityDetail(db, input.tenantId, opp.id),
    created: true,
    outbox: [outbox],
  }
}

export function listOpportunitiesOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ListOpportunitiesInput,
  clock: Clock,
): { items: OpportunityListItem[]; counts: StageCount[] } {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  return listOpportunities(db, meta.tenantId, input)
}

export function getOpportunityOp(
  db: ClinicDb,
  caller: ClinicCaller,
  opportunityId: string,
  clock: Clock,
): OpportunityDetail {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  return getOpportunityDetail(db, meta.tenantId, opportunityId)
}

/**
 * Mover etapa — NÃO cria nem altera compromisso (DEC-040).
 * «Horário proposto» não reserva recursos; «Agendado» pode ficar sem vínculo.
 * Falha de concorrência (expectedUpdatedAt) preserva estado anterior.
 */
export function moveOpportunityStageOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: MoveStageInput,
  clock: Clock,
): PipelineMutationResult<OpportunityDetail> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  requireActor(caller)

  if (!isOpportunityStage(input.toStage)) {
    throw new ValidationError('invalid_stage', `Etapa inválida: ${input.toStage}`)
  }

  return db.transactionSync(() => {
    const before = requireOpportunity(db, meta.tenantId, input.opportunityId)

    if (
      input.expectedUpdatedAt != null &&
      input.expectedUpdatedAt !== before.updatedAt
    ) {
      throw new ConflictError(
        'opportunity_stale',
        'O contato em andamento foi atualizado noutro sítio. Estado anterior preservado.',
      )
    }

    if (before.stage === input.toStage && before.status === (isTerminalStage(input.toStage) ? 'closed' : 'open')) {
      return {
        value: getOpportunityDetail(db, meta.tenantId, before.id),
        outbox: [],
      }
    }

    const now = clock.nowMs()
    const nextStatus = isTerminalStage(input.toStage) ? 'closed' : 'open'
    // DEC-040: mudar etapa nunca cria/altera agenda — linked_appointment_id intacto.
    updateOpportunityStage(db, {
      tenantId: meta.tenantId,
      opportunityId: before.id,
      stage: input.toStage,
      status: nextStatus,
      updatedAt: now,
      lastInteractionAt: now,
    })

    if (nextStatus === 'closed') {
      // Reserva por bloco: fechar o contato liberta o bloco em aberto.
      db.run(
        `UPDATE schedule_holds
         SET status = 'cancelled', cancelled_at = ?, updated_at = ?,
             alert_dismissed_at = COALESCE(alert_dismissed_at, ?)
         WHERE tenant_id = ? AND opportunity_id = ? AND status IN ('active', 'expired')`,
        now,
        now,
        now,
        meta.tenantId,
        before.id,
      )
    }

    insertStageHistory(
      db,
      {
        tenantId: meta.tenantId,
        opportunityId: before.id,
        fromStage: before.stage,
        toStage: input.toStage,
        actorClerkUserId: input.actorClerkUserId,
        actorDisplayName: input.actorDisplayName,
        note: input.note ?? null,
        createdAt: now,
      },
      clock,
    )

    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: input.actorClerkUserId,
        action: 'opportunity.stage_moved',
        objectType: 'opportunity',
        objectId: before.id,
        detail: {
          fromStage: before.stage,
          toStage: input.toStage,
          linkedAppointmentId: before.linkedAppointmentId,
          appointmentUnchanged: true,
        },
      },
      clock,
    )

    const outbox = insertOutboxEvent(
      db,
      {
        tenantId: meta.tenantId,
        type: 'opportunity.stage_changed',
        aggregateType: 'opportunity',
        aggregateId: before.id,
        idempotencyKey: `opportunity.stage_changed:${before.id}:${now}`,
        payload: {
          opportunityId: before.id,
          conversationId: before.conversationId,
          contactId: before.contactId,
          fromStage: before.stage,
          toStage: input.toStage,
          status: nextStatus,
          actorClerkUserId: input.actorClerkUserId,
          linkedAppointmentId: before.linkedAppointmentId,
          missingAppointment:
            input.toStage === 'agendado' && !before.linkedAppointmentId,
        },
      },
      clock,
    )

    return {
      value: getOpportunityDetail(db, meta.tenantId, before.id),
      outbox: [outbox],
    }
  })
}

/**
 * Vincula compromisso já existente — não cria reserva (agenda #35/#36).
 * Apenas associa IDs; stage não muda automaticamente.
 */
export function linkAppointmentOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: LinkAppointmentInput,
  clock: Clock,
): PipelineMutationResult<OpportunityDetail> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  requireActor(caller)

  return db.transactionSync(() => {
    const before = requireOpportunity(db, meta.tenantId, input.opportunityId)
    const apt = loadLinkedAppointment(db, meta.tenantId, input.appointmentId)
    if (!apt) {
      throw new NotFoundError('appointment_not_found', 'Compromisso não encontrado nesta clínica')
    }

    const now = clock.nowMs()
    db.run(
      `UPDATE appointments SET opportunity_id = ?, contact_id = ?, conversation_id = ?
       WHERE tenant_id = ? AND id = ?`,
      before.id,
      before.contactId,
      before.conversationId,
      meta.tenantId,
      input.appointmentId,
    )
    setLinkedAppointment(db, {
      tenantId: meta.tenantId,
      opportunityId: before.id,
      appointmentId: input.appointmentId,
      updatedAt: now,
    })

    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: input.actorClerkUserId,
        action: 'opportunity.appointment_linked',
        objectType: 'opportunity',
        objectId: before.id,
        detail: { appointmentId: input.appointmentId },
      },
      clock,
    )

    const outbox = insertOutboxEvent(
      db,
      {
        tenantId: meta.tenantId,
        type: 'opportunity.appointment_linked',
        aggregateType: 'opportunity',
        aggregateId: before.id,
        idempotencyKey: `opportunity.appointment_linked:${before.id}:${input.appointmentId}`,
        payload: {
          opportunityId: before.id,
          appointmentId: input.appointmentId,
          conversationId: before.conversationId,
          contactId: before.contactId,
        },
      },
      clock,
    )

    return {
      value: getOpportunityDetail(db, meta.tenantId, before.id),
      outbox: [outbox],
    }
  })
}

/**
 * VAL-02 fixture: reabre ciclo após Concluído/Perdido — nova oportunidade open.
 * Não apaga histórico do ciclo anterior.
 */
export function reopenOpportunityCycleOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ReopenOpportunityInput,
  clock: Clock,
): PipelineMutationResult<OpportunityDetail> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  requireActor(caller)

  return db.transactionSync(() => {
    const conversation = requireConversation(
      db,
      meta.tenantId,
      input.conversationId,
    )
    const open = findOpenOpportunityForConversation(
      db,
      meta.tenantId,
      input.conversationId,
    )
    if (open) {
      throw new ConflictError(
        'opportunity_already_open',
        'Já existe um contato em andamento aberto nesta conversa',
      )
    }

    const ensured = ensureOpenOpportunity(
      db,
      {
        tenantId: meta.tenantId,
        contactId: conversation.contactId,
        conversationId: conversation.id,
        assigneeClerkUserId: conversation.assigneeClerkUserId,
        assigneeDisplayName: conversation.assigneeDisplayName,
      },
      clock,
    )

    const outboxes = [...ensured.outbox]
    const opportunityId = ensured.opportunity.id

    if (input.initialStage && input.initialStage !== 'novo_contato') {
      if (!isOpportunityStage(input.initialStage)) {
        throw new ValidationError('invalid_stage', `Etapa inválida: ${input.initialStage}`)
      }
      const now = clock.nowMs()
      const before = requireOpportunity(db, meta.tenantId, opportunityId)
      const nextStatus = isTerminalStage(input.initialStage) ? 'closed' : 'open'
      updateOpportunityStage(db, {
        tenantId: meta.tenantId,
        opportunityId,
        stage: input.initialStage,
        status: nextStatus,
        updatedAt: now,
        lastInteractionAt: now,
      })
      insertStageHistory(
        db,
        {
          tenantId: meta.tenantId,
          opportunityId,
          fromStage: before.stage,
          toStage: input.initialStage,
          actorClerkUserId: input.actorClerkUserId,
          actorDisplayName: input.actorDisplayName,
          note: 'Reabertura com etapa inicial (VAL-02 fixture)',
          createdAt: now,
        },
        clock,
      )
      outboxes.push(
        insertOutboxEvent(
          db,
          {
            tenantId: meta.tenantId,
            type: 'opportunity.stage_changed',
            aggregateType: 'opportunity',
            aggregateId: opportunityId,
            idempotencyKey: `opportunity.stage_changed:${opportunityId}:${now}`,
            payload: {
              opportunityId,
              conversationId: before.conversationId,
              contactId: before.contactId,
              fromStage: before.stage,
              toStage: input.initialStage,
              status: nextStatus,
              actorClerkUserId: input.actorClerkUserId,
              linkedAppointmentId: before.linkedAppointmentId,
              missingAppointment:
                input.initialStage === 'agendado' && !before.linkedAppointmentId,
            },
          },
          clock,
        ),
      )
    }

    return {
      value: getOpportunityDetail(db, meta.tenantId, opportunityId),
      outbox: outboxes,
    }
  })
}
