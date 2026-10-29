import type {
  AppointmentProposalBeneficiaryKind,
  AppointmentProposalState,
} from '../constants'

/** Snapshot factual persistido — IDs validados no backend (nunca confiança no LLM). */
export type AppointmentProposalRow = {
  id: string
  tenantId: string
  lineageId: string
  version: number
  contactId: string
  conversationId: string
  state: AppointmentProposalState
  clinicLocationText: string
  beneficiaryKind: AppointmentProposalBeneficiaryKind
  beneficiaryName: string
  serviceId: string
  serviceName: string
  professionalId: string | null
  professionalName: string | null
  startsAt: number
  endsAt: number
  durationMinutes: number
  timezone: string
  priceCents: number | null
  requiresSignal: boolean
  signalKind: string | null
  signalFixedCents: number | null
  signalPercent: number | null
  signalConditionsText: string
  expiresAt: number | null
  sentAt: number | null
  supersededById: string | null
  appointmentId: string | null
  createdAt: number
  updatedAt: number
}

export type CreateAppointmentProposalInput = {
  contactId: string
  conversationId: string
  serviceId: string
  /** Obrigatório quando o serviço tem profissionais; validado no catálogo. */
  professionalId?: string | null
  startsAt: number
  endsAt?: number
  durationMinutes?: number
  beneficiaryKind?: AppointmentProposalBeneficiaryKind
  /** Obrigatório se beneficiaryKind = terceiro. */
  beneficiaryName?: string | null
  /** Texto de condições do sinal (opcional; snapshot). */
  signalConditionsText?: string | null
}

export type ProposalAuthorizationDenial =
  | 'not_found'
  | 'tenant_mismatch'
  | 'contact_mismatch'
  | 'conversation_mismatch'
  | 'not_enviada'
  | 'expired'
  | 'fabricated_id'

export type ProposalAuthorizationResult =
  | { allowed: true; proposal: AppointmentProposalRow }
  | { allowed: false; reason: ProposalAuthorizationDenial; proposal: AppointmentProposalRow | null }
