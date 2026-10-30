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
  /** DEC-075 / S6 — sala sem vaga de pessoa no bloco. */
  'room_at_capacity',
  /** DEC-075 / S6 — profissional já marcada noutra sala no mesmo bloco. */
  'professional_other_room',
  /** DEC-075 / S5 — audiência oposta ao sexo do bloco na sala. */
  'room_sex_mismatch',
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
  /**
   * DEC-077. Omisso = equipe: a hora fica na lista.
   * Automático omite a hora que não serve; quem chama passa `tempoKeeps`.
   */
  tempoMode?: 'equipe' | 'automatico'
  /** Só no modo automático, quando o serviço tem restrição. Sem isto, a lista fica vazia. */
  tempoKeeps?: (startsAt: number) => boolean
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
  /** Frase fixa da sala para a confirmação pelo WhatsApp (DEC-053); sem nº de vagas. */
  roomSharedNotice?: string | null
  /** Sala compartilhada: capacidade e lugares livres no pico do período (só exibição; null em sala de 1). */
  roomCapacity?: number | null
  roomSeatsFree?: number | null
  /** Avisos do bloco Tempo para a equipe (DEC-077). A hora continua na lista. */
  tempoWarnings?: string[]
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
  /** Sexo do bloco quando a recusa é room_sex_mismatch (S6). */
  blockSex?: 'feminino' | 'masculino' | null
  slot: AvailableSlot | null
  asOf: number
  /** Leitura pura — não cria reserva (AC #35). */
  createdReservation: false
}
