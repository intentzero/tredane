import type { OpportunityStage, OpportunityStatus } from '../constants'
import type {
  LinkedAppointmentSummary,
  OpportunityRow,
  StageHistoryRow,
} from './types'

export function mapOpportunity(row: {
  id: string
  tenant_id: string
  contact_id: string
  conversation_id: string
  stage: string
  status: string
  cycle_number: number
  assignee_clerk_user_id: string | null
  assignee_display_name: string | null
  last_interaction_at: number | null
  linked_appointment_id: string | null
  created_at: number
  updated_at: number
}): OpportunityRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    stage: row.stage as OpportunityStage,
    status: row.status as OpportunityStatus,
    cycleNumber: row.cycle_number,
    assigneeClerkUserId: row.assignee_clerk_user_id,
    assigneeDisplayName: row.assignee_display_name,
    lastInteractionAt: row.last_interaction_at,
    linkedAppointmentId: row.linked_appointment_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapStageHistory(row: {
  id: string
  tenant_id: string
  opportunity_id: string
  from_stage: string | null
  to_stage: string
  actor_clerk_user_id: string | null
  actor_display_name: string | null
  note: string | null
  created_at: number
}): StageHistoryRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    opportunityId: row.opportunity_id,
    fromStage: (row.from_stage as OpportunityStage | null) ?? null,
    toStage: row.to_stage as OpportunityStage,
    actorClerkUserId: row.actor_clerk_user_id,
    actorDisplayName: row.actor_display_name,
    note: row.note,
    createdAt: row.created_at,
  }
}

export function mapLinkedAppointment(row: {
  id: string
  starts_at: number
  ends_at: number
  status: string
  contact_label: string | null
  service_id: string
  professional_id: string
}): LinkedAppointmentSummary {
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status as 'confirmed' | 'cancelled',
    contactLabel: row.contact_label,
    serviceId: row.service_id,
    professionalId: row.professional_id,
  }
}
