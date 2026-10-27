import type { Clock } from '../../db/clock'
import type { OpportunityStage } from '../constants'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import {
  getOpportunity,
  insertStageHistory,
  isTerminalStage,
  updateOpportunityStage,
} from '../pipeline/opportunities'
import type { ClinicDb } from '../store'

/** Move a oportunidade de etapa com histórico e evento (no-op se já está / fechada). */
export function moveStage(
  db: ClinicDb,
  tenantId: string,
  opportunityId: string,
  toStage: OpportunityStage,
  actor: { id: string; name: string | null },
  note: string,
  clock: Clock,
  outbox: OutboxRow[],
  onlyFrom?: OpportunityStage[],
): void {
  const before = getOpportunity(db, tenantId, opportunityId)
  if (!before || before.status !== 'open') return
  if (before.stage === toStage) return
  if (onlyFrom && !onlyFrom.includes(before.stage)) return
  const now = clock.nowMs()
  const nextStatus = isTerminalStage(toStage) ? 'closed' : 'open'
  updateOpportunityStage(db, {
    tenantId,
    opportunityId,
    stage: toStage,
    status: nextStatus,
    updatedAt: now,
    lastInteractionAt: now,
  })
  insertStageHistory(
    db,
    {
      tenantId,
      opportunityId,
      fromStage: before.stage,
      toStage,
      actorClerkUserId: actor.id,
      actorDisplayName: actor.name,
      note,
      createdAt: now,
    },
    clock,
  )
  outbox.push(
    insertOutboxEvent(
      db,
      {
        tenantId,
        type: 'opportunity.stage_changed',
        aggregateType: 'opportunity',
        aggregateId: opportunityId,
        idempotencyKey: `opportunity.stage_changed:${opportunityId}:${now}:${toStage}`,
        payload: {
          opportunityId,
          conversationId: before.conversationId,
          contactId: before.contactId,
          fromStage: before.stage,
          toStage,
          status: nextStatus,
          actorClerkUserId: actor.id,
          linkedAppointmentId: before.linkedAppointmentId,
          missingAppointment: false,
        },
      },
      clock,
    ),
  )
}

