import type { ServiceAudience } from '../catalog/audience'
import type { BlockReason, ResourceKind } from '../constants'

export type ServiceSignalKind = 'fixed' | 'percent'

export type ServiceRow = {
  id: string
  tenantId: string
  name: string
  durationMinutes: number
  bufferMinutes: number
  /** DEC-075 — audiência do serviço (não da pessoa). */
  audiencia: ServiceAudience
  priceCents: number | null
  clientExplanation: string | null
  active: boolean
  /** REQ-076 — sinal por serviço (só owner configura). */
  requiresSignal: boolean
  signalKind: ServiceSignalKind | null
  signalFixedCents: number | null
  signalPercent: number | null
  /** DEC-051 — a atendente pode ajustar a duração no Agendar (só a owner configura). */
  durationAdjustable: boolean
  durationMinMinutes: number | null
  durationMaxMinutes: number | null
  createdAt: number
  updatedAt: number
  professionalIds: string[]
  roomRequirement: RoomRequirement
  /**
   * Horário semanal em que o serviço pode ser prestado (issue #261).
   * Vazio = sem filtro (só expediente da profissional / sala).
   */
  weeklyWindows: ServiceWeeklyWindowSpec[]
  /** Pode ser apagado: nunca teve marcação, Pix ou proposta ligada. */
  deletable: boolean
}

/** Faixa semanal de oferta do serviço (sem id estável na API de gravação). */
export type ServiceWeeklyWindowSpec = {
  dayOfWeek: number
  startMinute: number
  endMinute: number
}

export type ServiceWeeklyWindowRow = ServiceWeeklyWindowSpec & {
  id: string
  tenantId: string
  serviceId: string
}

export type RoomRequirement =
  | { mode: 'none' }
  | { mode: 'any' }
  | { mode: 'category'; category: string }
  | { mode: 'resource'; resourceId: string }

/** Escopo reservado: horário e fechamentos da clínica inteira (em `weekly_windows` / `resource_blocks`). */
export const CLINIC_SCOPE_ID = '__clinic__'

export type ResourceRow = {
  id: string
  tenantId: string
  kind: ResourceKind
  name: string
  category: string | null
  active: boolean
  createdAt: number
  updatedAt: number
  /** Pessoas ao mesmo tempo (só sala; profissional/equipamento = 1). */
  capacity: number
  /** Frase fixa da clínica na confirmação pelo WhatsApp (DEC-053). */
  sharedSpaceNotice: string | null
  /** Profissional: segue o horário da clínica (`clinic`) ou tem horário próprio (`own`). */
  hoursMode: 'clinic' | 'own'
  futureAppointmentCount: number
  /** Já teve compromisso (passado ou futuro): não pode ser excluído. */
  hasAppointmentHistory: boolean
}

export type WeeklyWindowRow = {
  id: string
  tenantId: string
  resourceId: string
  dayOfWeek: number
  startMinute: number
  endMinute: number
}

export type ResourceBlockRow = {
  id: string
  tenantId: string
  resourceId: string
  startsAt: number
  endsAt: number
  reason: BlockReason
  note: string | null
  createdAt: number
}

export type AppointmentRow = {
  id: string
  tenantId: string
  serviceId: string
  professionalId: string
  roomResourceId: string | null
  startsAt: number
  endsAt: number
  status: 'confirmed' | 'cancelled'
  contactLabel: string | null
  createdAt: number
  /** Vínculos Acompanhamento (#30); null até ligação explícita. */
  contactId: string | null
  conversationId: string | null
  opportunityId: string | null
  /** #36 — versão monotónica (confirmação / cancel / reagendar). */
  version: number
  updatedAt: number | null
  confirmedBy: string | null
  confirmedAt: number | null
  changeReason: string | null
  cancelledBy: string | null
  cancelledAt: number | null
  /** Ocupação efetiva (duração + buffer) no momento da confirmação. */
  occupiesUntil: number | null
  /** DEC-051(g) — duração padrão do serviço na marcação e a aplicada. */
  defaultDurationMinutes: number | null
  appliedDurationMinutes: number | null
}

export type ClinicSettingsRow = {
  tenantId: string
  timezone: string
  /** Prazo padrão do sinal em segundos (DEC-047: 7200). */
  signalDeadlineSeconds: number
  /** Política de cancelamento do sinal (texto da clínica). */
  signalCancellationPolicy: string
  /** Opt-in de IA assistiva pela clínica (default false; política §6). */
  aiAssistEnabled: boolean
  /** Endereço da clínica (contexto da IA). */
  clinicAddress: string
  /** Link do Google Business (https; vazio = sem link). Definido só pela clínica; contexto da IA. */
  googleBusinessUrl: string
  /** Regras de remarcação e cancelamento (texto da clínica; contexto da IA). */
  reschedulePolicy: string
  /**
   * Limites de abuso — owner (DEC-042 / Paulo 29/10/2026).
   * Default enabled=false (fail-closed por clínica).
   */
  abuseLimitsEnabled: boolean
  /** Pausa novas marcações automáticas por botão; AI_AUTOBOOK=off continua a vencer. */
  autoBookPaused: boolean
  abuseWindowHours: number
  abuseAutoDraftsPerContact: number
  abuseAiBookingsPerContact: number
  abuseAiBookingsPerClinic: number
  abuseFutureAppointmentsPerContact: number
  abusePendingPixPerContact: number
  abusePendingProposalsPerContact: number
  abuseProposalsPerContact: number
  abuseProposalsPerClinic: number
  updatedAt: number
}

/** Corpo de PATCH dos limites de abuso (owner). */
export type UpdateAbuseLimitsInput = {
  enabled?: boolean
  autoBookPaused?: boolean
  windowHours?: number
  autoDraftsPerContact?: number
  aiBookingsPerContact?: number
  aiBookingsPerClinic?: number
  futureAppointmentsPerContact?: number
  pendingPixPerContact?: number
  pendingProposalsPerContact?: number
  proposalsPerContact?: number
  proposalsPerClinic?: number
  /** Restaura números Confirmados (não altera enabled / autoBookPaused salvo se enviados). */
  resetToDefaults?: boolean
}

export type ConfigReadiness = {
  /** Serviços + profissional + sala/equipamento + expediente mínimo (REQ-052 agenda). */
  agendaConfigured: boolean
  /** Agenda configurada + WhatsApp conectado (#31 / AC-14). */
  readyToServe: boolean
  /** Novos agendamentos só com agendaConfigured. */
  schedulingAllowed: boolean
  missing: Array<
    | 'service'
    | 'professional'
    | 'room_or_equipment'
    | 'weekly_availability'
    | 'whatsapp'
  >
  timezone: string
  counts: {
    servicesActive: number
    professionalsActive: number
    roomsActive: number
    resourcesWithWeekly: number
  }
}

export type ConfigSnapshot = {
  settings: ClinicSettingsRow
  services: ServiceRow[]
  resources: ResourceRow[]
  weeklyWindows: WeeklyWindowRow[]
  blocks: ResourceBlockRow[]
  readiness: ConfigReadiness
}

export type UpsertServiceInput = {
  id?: string
  name: string
  durationMinutes: number
  bufferMinutes: number
  /** Omitido na criação = qualquer; omitido na edição = mantém. Nunca inferir pelo nome. */
  audiencia?: ServiceAudience
  priceCents?: number | null
  clientExplanation?: string | null
  active?: boolean
  professionalIds: string[]
  roomRequirement?: RoomRequirement
  requiresSignal?: boolean
  signalKind?: ServiceSignalKind | null
  signalFixedCents?: number | null
  signalPercent?: number | null
  /** DEC-051 — só a owner configura (DEC-042). */
  durationAdjustable?: boolean
  durationMinMinutes?: number | null
  durationMaxMinutes?: number | null
  /** Omitido na atualização = mantém faixas actuais; array (mesmo vazio) substitui. */
  weeklyWindows?: ServiceWeeklyWindowSpec[]
}

export type UpsertResourceInput = {
  id?: string
  kind: ResourceKind
  name: string
  category?: string | null
  active?: boolean
  /** Só sala: 1–50. Omitido = mantém (ou 1 ao criar). */
  capacity?: number
  sharedSpaceNotice?: string | null
  /** Só profissional. Omitido = mantém (ao criar: `clinic` se a clínica já tem horário, senão `own`). */
  hoursMode?: 'clinic' | 'own'
}

export type SetWeeklyWindowsInput = {
  resourceId: string
  windows: Array<{
    dayOfWeek: number
    startMinute: number
    endMinute: number
  }>
}

export type CreateBlockInput = {
  resourceId: string
  startsAt: number
  endsAt: number
  reason: BlockReason
  note?: string | null
  /** Se true e há compromissos, não grava — devolve só a lista (pré-visualização). */
  dryRun?: boolean
}

export type CreateBlockResult = {
  created: boolean
  block: ResourceBlockRow | null
  affectedAppointments: AppointmentRow[]
}
