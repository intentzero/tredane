/**
 * Etapa da oportunidade alinhada aos compromissos confirmados (DEC-092 / DEC-094).
 * Futuro = confirmado com fim ainda à frente. O buffer da sala não entra no fim.
 */
import type { Clock } from '../../db/clock'
import type { OpportunityStage } from '../constants'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import {
  findOpenOpportunityForConversation,
  insertStageHistory,
  isTerminalStage,
  setLinkedAppointment,
  updateOpportunityStage,
} from './opportunities'

type FutureRow = { id: string; starts_at: number; ends_at: number }

export function syncOpenOpportunityAssignee(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    assigneeClerkUserId: string | null
    assigneeDisplayName: string | null
    updatedAt: number
  },
): void {
  db.run(
    `UPDATE opportunities SET
       assignee_clerk_user_id = ?,
       assignee_display_name = ?,
       updated_at = ?
     WHERE tenant_id = ? AND conversation_id = ? AND status = 'open'`,
    input.assigneeClerkUserId,
    input.assigneeDisplayName,
    input.updatedAt,
    input.tenantId,
    input.conversationId,
  )
}

export function conversationHasFutureConfirmed(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  nowMs: number,
): boolean {
  const row = db.get<{ id: string }>(
    `SELECT id FROM appointments
     WHERE tenant_id = ? AND conversation_id = ? AND status = 'confirmed' AND ends_at > ?
     LIMIT 1`,
    tenantId,
    conversationId,
    nowMs,
  )
  return Boolean(row)
}

function futureConfirmed(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  nowMs: number,
): FutureRow[] {
  return db.all<FutureRow>(
    `SELECT id, starts_at, ends_at FROM appointments
     WHERE tenant_id = ? AND conversation_id = ? AND status = 'confirmed' AND ends_at > ?
     ORDER BY starts_at ASC, id ASC`,
    tenantId,
    conversationId,
    nowMs,
  )
}

function moveStage(
  db: ClinicDb,
  input: {
    tenantId: string
    opportunityId: string
    conversationId: string
    contactId: string
    fromStage: OpportunityStage
    toStage: OpportunityStage
    status: 'open' | 'closed'
    linkedAppointmentId: string | null
    actorClerkUserId: string
    actorDisplayName: string
    note: string
    now: number
  },
  clock: Clock,
): OutboxRow {
  updateOpportunityStage(db, {
    tenantId: input.tenantId,
    opportunityId: input.opportunityId,
    stage: input.toStage,
    status: input.status,
    updatedAt: input.now,
    lastInteractionAt: input.now,
  })
  insertStageHistory(
    db,
    {
      tenantId: input.tenantId,
      opportunityId: input.opportunityId,
      fromStage: input.fromStage,
      toStage: input.toStage,
      actorClerkUserId: input.actorClerkUserId,
      actorDisplayName: input.actorDisplayName,
      note: input.note,
      createdAt: input.now,
    },
    clock,
  )
  return insertOutboxEvent(
    db,
    {
      tenantId: input.tenantId,
      type: 'opportunity.stage_changed',
      aggregateType: 'opportunity',
      aggregateId: input.opportunityId,
      idempotencyKey: `opportunity.stage_changed:${input.opportunityId}:${input.now}:${input.toStage}`,
      payload: {
        opportunityId: input.opportunityId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        fromStage: input.fromStage,
        toStage: input.toStage,
        status: input.status,
        actorClerkUserId: input.actorClerkUserId,
        linkedAppointmentId: input.linkedAppointmentId,
        missingAppointment: input.toStage === 'agendado' && !input.linkedAppointmentId,
        automatic: true,
      },
    },
    clock,
  )
}

/**
 * Com compromisso futuro: fica em Agendado e aponta para o mais próximo.
 * Sem futuro: não-comparecimento ou fim da visita vão a Concluído;
 * o cancelamento dos outros motivos volta a Em atendimento e solta o vínculo.
 */
export function alignOpportunityToAppointments(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    now: number
    actorClerkUserId: string
    actorDisplayName: string
    noShowAppointmentId?: string | null
    endedAppointmentId?: string | null
  },
  clock: Clock,
): OutboxRow[] {
  const opp = findOpenOpportunityForConversation(db, input.tenantId, input.conversationId)
  if (!opp || isTerminalStage(opp.stage)) return []
  const futures = futureConfirmed(db, input.tenantId, input.conversationId, input.now)
  const outbox: OutboxRow[] = []
  if (futures.length > 0) {
    const next = futures[0]!
    if (opp.linkedAppointmentId !== next.id) {
      setLinkedAppointment(db, {
        tenantId: input.tenantId,
        opportunityId: opp.id,
        appointmentId: next.id,
        updatedAt: input.now,
      })
    }
    if (opp.stage !== 'agendado') {
      outbox.push(
        moveStage(
          db,
          {
            tenantId: input.tenantId,
            opportunityId: opp.id,
            conversationId: opp.conversationId,
            contactId: opp.contactId,
            fromStage: opp.stage,
            toStage: 'agendado',
            status: 'open',
            linkedAppointmentId: next.id,
            actorClerkUserId: input.actorClerkUserId,
            actorDisplayName: input.actorDisplayName,
            note: 'Automática: ainda há horário confirmado',
            now: input.now,
          },
          clock,
        ),
      )
    } else if (opp.linkedAppointmentId !== next.id) {
      outbox.push(
        insertOutboxEvent(
          db,
          {
            tenantId: input.tenantId,
            type: 'opportunity.stage_changed',
            aggregateType: 'opportunity',
            aggregateId: opp.id,
            idempotencyKey: `opportunity.stage_changed:${opp.id}:${input.now}:retarget`,
            payload: {
              opportunityId: opp.id,
              conversationId: opp.conversationId,
              contactId: opp.contactId,
              fromStage: opp.stage,
              toStage: 'agendado',
              status: 'open',
              actorClerkUserId: input.actorClerkUserId,
              linkedAppointmentId: next.id,
              missingAppointment: false,
              automatic: true,
            },
          },
          clock,
        ),
      )
    }
    return outbox
  }

  if (input.noShowAppointmentId) {
    setLinkedAppointment(db, {
      tenantId: input.tenantId,
      opportunityId: opp.id,
      appointmentId: input.noShowAppointmentId,
      updatedAt: input.now,
    })
    outbox.push(
      moveStage(
        db,
        {
          tenantId: input.tenantId,
          opportunityId: opp.id,
          conversationId: opp.conversationId,
          contactId: opp.contactId,
          fromStage: opp.stage,
          toStage: 'concluido',
          status: 'closed',
          linkedAppointmentId: input.noShowAppointmentId,
          actorClerkUserId: input.actorClerkUserId,
          actorDisplayName: input.actorDisplayName,
          note: 'Não compareceu',
          now: input.now,
        },
        clock,
      ),
    )
    return outbox
  }

  if (input.endedAppointmentId) {
    if (opp.linkedAppointmentId !== input.endedAppointmentId) {
      setLinkedAppointment(db, {
        tenantId: input.tenantId,
        opportunityId: opp.id,
        appointmentId: input.endedAppointmentId,
        updatedAt: input.now,
      })
    }
    outbox.push(
      moveStage(
        db,
        {
          tenantId: input.tenantId,
          opportunityId: opp.id,
          conversationId: opp.conversationId,
          contactId: opp.contactId,
          fromStage: opp.stage,
          toStage: 'concluido',
          status: 'closed',
          linkedAppointmentId: input.endedAppointmentId,
          actorClerkUserId: input.actorClerkUserId,
          actorDisplayName: input.actorDisplayName,
          note: 'Automática: o horário confirmado terminou',
          now: input.now,
        },
        clock,
      ),
    )
    return outbox
  }

  if (opp.linkedAppointmentId) {
    setLinkedAppointment(db, {
      tenantId: input.tenantId,
      opportunityId: opp.id,
      appointmentId: null,
      updatedAt: input.now,
    })
  }
  if (opp.stage !== 'em_atendimento') {
    outbox.push(
      moveStage(
        db,
        {
          tenantId: input.tenantId,
          opportunityId: opp.id,
          conversationId: opp.conversationId,
          contactId: opp.contactId,
          fromStage: opp.stage,
          toStage: 'em_atendimento',
          status: 'open',
          linkedAppointmentId: null,
          actorClerkUserId: input.actorClerkUserId,
          actorDisplayName: input.actorDisplayName,
          note: 'Automática: o horário foi cancelado',
          now: input.now,
        },
        clock,
      ),
    )
  }
  return outbox
}

export function sweepEndedAppointments(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): OutboxRow[] {
  const now = clock.nowMs()
  const rows = db.all<{ id: string; conversation_id: string }>(
    `SELECT a.id AS id, a.conversation_id AS conversation_id
     FROM appointments a
     JOIN opportunities o
       ON o.tenant_id = a.tenant_id
      AND o.conversation_id = a.conversation_id
      AND o.status = 'open'
      AND o.stage = 'agendado'
      AND o.linked_appointment_id = a.id
     WHERE a.tenant_id = ?
       AND a.status = 'confirmed'
       AND a.ends_at <= ?
       AND a.conversation_id IS NOT NULL`,
    tenantId,
    now,
  )
  const outbox: OutboxRow[] = []
  for (const row of rows) {
    outbox.push(
      ...alignOpportunityToAppointments(
        db,
        {
          tenantId,
          conversationId: row.conversation_id,
          now,
          actorClerkUserId: 'system:appointment-ended',
          actorDisplayName: 'Sistema',
          endedAppointmentId: row.id,
        },
        clock,
      ),
    )
  }
  return outbox
}

export function nextOpenAppointmentEndAt(
  db: ClinicDb,
  tenantId: string,
  nowMs: number,
): number | null {
  const row = db.get<{ t: number | null }>(
    `SELECT MIN(a.ends_at) AS t
     FROM appointments a
     JOIN opportunities o
       ON o.tenant_id = a.tenant_id
      AND o.conversation_id = a.conversation_id
      AND o.status = 'open'
      AND o.stage = 'agendado'
     WHERE a.tenant_id = ?
       AND a.status = 'confirmed'
       AND a.ends_at > ?`,
    tenantId,
    nowMs,
  )
  return row?.t ?? null
}
