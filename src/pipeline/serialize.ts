import type {
  LinkedAppointmentSummary,
  OpportunityDetail,
  OpportunityListItem,
  OpportunityRow,
  StageCount,
  StageHistoryRow,
} from '../clinic/pipeline'
import { serializeContact } from '../inbox/serialize'
import { serializeHold } from '../scheduling/serialize'

export function serializeLinkedAppointment(a: LinkedAppointmentSummary | null) {
  if (!a) return null
  return {
    id: a.id,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    status: a.status,
    contactLabel: a.contactLabel,
    serviceId: a.serviceId,
    professionalId: a.professionalId,
    changeReason: a.changeReason,
  }
}

export function serializeOpportunity(o: OpportunityRow | OpportunityListItem) {
  const base = {
    id: o.id,
    tenantId: o.tenantId,
    contactId: o.contactId,
    conversationId: o.conversationId,
    stage: o.stage,
    status: o.status,
    cycleNumber: o.cycleNumber,
    assigneeClerkUserId: o.assigneeClerkUserId,
    assigneeDisplayName: o.assigneeDisplayName,
    lastInteractionAt: o.lastInteractionAt,
    linkedAppointmentId: o.linkedAppointmentId,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  }
  if ('contact' in o) {
    return {
      ...base,
      contact: serializeContact(o.contact),
      missingAppointment: o.missingAppointment,
      linkedAppointment: serializeLinkedAppointment(o.linkedAppointment),
      openHold: o.openHold ? serializeHold(o.openHold) : null,
    }
  }
  return base
}

export function serializeStageHistory(h: StageHistoryRow) {
  return {
    id: h.id,
    tenantId: h.tenantId,
    opportunityId: h.opportunityId,
    fromStage: h.fromStage,
    toStage: h.toStage,
    actorClerkUserId: h.actorClerkUserId,
    actorDisplayName: h.actorDisplayName,
    note: h.note,
    createdAt: h.createdAt,
  }
}

export function serializeOpportunityDetail(d: OpportunityDetail) {
  return {
    ...serializeOpportunity(d),
    history: d.history.map(serializeStageHistory),
  }
}

export function serializeStageCounts(counts: StageCount[]) {
  return counts.map((c) => ({
    stage: c.stage,
    label: c.label,
    count: c.count,
  }))
}
