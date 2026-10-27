/** Motivos de indisponibilidade observáveis (REQ-030 / issue #35). */
export const UNAVAILABILITY_REASONS = [
  'scheduling_not_allowed',
  'service_inactive_or_missing',
  'professional_unusable',
  'professional_not_linked',
  'room_unusable',
  'room_required',
  'room_requirement_mismatch',
  'room_category_mismatch',
  'outside_weekly_hours',
  'resource_block',
  'appointment_conflict',
  'crosses_day_boundary',
  'invalid_grid',
  'past_slot',
  /** Reserva por bloco: impediria um bloco reservado de caber no período. */
  'hold_conflict',
] as const

export type UnavailabilityReason = (typeof UNAVAILABILITY_REASONS)[number]

export type AvailabilityQueryInput = {
  /** Serviço da clínica (IDs de outro tenant são negados). */
  serviceId: string
  /** Data civil no fuso da clínica: YYYY-MM-DD. */
  date: string
  /**
   * Profissional concreto, ou omitido/`any` para o primeiro par livre
   * (UI «Qualquer disponível»).
   */
  professionalId?: string | null
  /** Definir hora de um bloco: o próprio bloco não conta como conflito. */
  excludeHoldId?: string | null
  /** Reserva por bloco: o compromisso ocupa a duração do bloco, não a do serviço. */
  durationMinutesOverride?: number | null
}

export type AvailableSlot = {
  startsAt: number
  /** Fim do atendimento (sem buffer) — exibição. */
  endsAt: number
  /** Fim da ocupação = duração + intervalo (DEC-008). */
  occupiesUntil: number
  professionalId: string
  professionalName: string
  roomResourceId: string | null
  roomResourceName: string | null
}

export type AvailabilityQueryResult = {
  tenantId: string
  timezone: string
  serviceId: string
  serviceName: string
  durationMinutes: number
  bufferMinutes: number
  occupiedMinutes: number
  date: string
  dayOfWeek: number
  dayStartsAt: number
  dayEndsAt: number
  schedulingAllowed: boolean
  /** Instante da consulta (relógio do DO) — UI pode refrescar após mudança remota. */
  asOf: number
  /** Grade livre; indisponíveis omitidos (TEL-05 / M-04). */
  slots: AvailableSlot[]
  /** Consulta de leitura — sempre false; confirmação atómica é #36. */
  createdReservation: false
}

export type CheckSlotInput = {
  serviceId: string
  professionalId: string
  roomResourceId?: string | null
  startsAt: number
  /** Reagendar: ignorar o compromisso actual na verificação de conflito. */
  excludeAppointmentId?: string | null
  /** Definir hora de um bloco: o próprio bloco não conta como conflito. */
  excludeHoldId?: string | null
  /** Reserva por bloco: o compromisso ocupa a duração do bloco, não a do serviço. */
  durationMinutesOverride?: number | null
}

export type CheckSlotResult = {
  available: boolean
  reasons: UnavailabilityReason[]
  slot: AvailableSlot | null
  asOf: number
  /** Leitura pura — não cria reserva (AC #35). */
  createdReservation: false
}
