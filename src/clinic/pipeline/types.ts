import type { OpportunityStage, OpportunityStatus } from '../constants'
import type { ContactSummary } from '../inbox/types'

export type OpportunityRow = {
  id: string
  tenantId: string
  contactId: string
  conversationId: string
  stage: OpportunityStage
  status: OpportunityStatus
  cycleNumber: number
  assigneeClerkUserId: string | null
  assigneeDisplayName: string | null
  lastInteractionAt: number | null
  linkedAppointmentId: string | null
  createdAt: number
  updatedAt: number
}

export type StageHistoryRow = {
  id: string
  tenantId: string
  opportunityId: string
  fromStage: OpportunityStage | null
  toStage: OpportunityStage
  actorClerkUserId: string | null
  actorDisplayName: string | null
  note: string | null
  createdAt: number
}

/** Resumo mínimo do compromisso vinculado (agenda completa = #35/#36). */
export type LinkedAppointmentSummary = {
  id: string
  startsAt: number
  endsAt: number
  status: 'confirmed' | 'cancelled'
  contactLabel: string | null
  serviceId: string
  professionalId: string
}

export type OpportunityListItem = OpportunityRow & {
  contact: ContactSummary
  /** True quando stage=agendado e sem compromisso (DEC-040). */
  missingAppointment: boolean
  linkedAppointment: LinkedAppointmentSummary | null
}

export type OpportunityDetail = OpportunityListItem & {
  history: StageHistoryRow[]
}

export type StageCount = {
  stage: OpportunityStage
  label: string
  count: number
}

export type ListOpportunitiesInput = {
  /** Se omitido, lista todas as open (+ terminais se includeClosed). */
  stage?: OpportunityStage | null
  includeClosed?: boolean
  limit?: number
}

export type MoveStageInput = {
  opportunityId: string
  toStage: OpportunityStage
  actorClerkUserId: string
  actorDisplayName: string
  /**
   * Concorrência otimista: se informado e diferente de updatedAt persistido,
   * a mutação falha com ConflictError e o estado anterior permanece.
   */
  expectedUpdatedAt?: number | null
  note?: string | null
}

export type LinkAppointmentInput = {
  opportunityId: string
  appointmentId: string
  actorClerkUserId: string
  actorDisplayName: string
}

export type ReopenOpportunityInput = {
  conversationId: string
  actorClerkUserId: string
  actorDisplayName: string
  /** Etapa inicial do novo ciclo (default: novo_contato). */
  initialStage?: OpportunityStage
}
