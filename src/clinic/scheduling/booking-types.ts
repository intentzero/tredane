import type { ScheduleHoldView } from './hold-rows'
import type { AppointmentChangeReason } from '../constants'
import type { AppointmentRow, ComboSnapshot, ZoneSnapshot } from '../config/types'
import type { OutboxRow } from '../outbox'
import type { UnavailabilityReason } from './types'

export type AppointmentMutationResult<T> = {
  value: T
  outbox: OutboxRow[]
  /** true se o clientRequestId já tinha sido processado. */
  idempotentReplay: boolean
  /** Aviso do bloco Tempo na resposta da marcação manual (DEC-077). Não fica no compromisso. */
  tempoWarnings?: string[]
  /** DEC-095: aviso de cancelamento no WhatsApp. A falha não desfaz o cancelamento. */
  cancelNotice?: 'sent' | 'window_closed' | 'failed' | 'skipped'
  /** DEC-097: aviso de reagendamento no WhatsApp. A falha não desfaz a mudança. */
  rescheduleNotice?: 'sent' | 'window_closed' | 'failed' | 'skipped'
}

export type ConfirmAppointmentInput = {
  clientRequestId: string
  serviceId: string
  professionalId: string
  roomResourceId?: string | null
  startsAt: number
  /** Rótulo sintético quando ainda não há contacto. */
  contactLabel?: string | null
  contactId?: string | null
  conversationId?: string | null
  opportunityId?: string | null
  actorClerkUserId: string
  /** Definir hora de um bloco: o próprio bloco não conta como conflito. */
  excludeHoldId?: string | null
  /** Reserva por bloco: o compromisso ocupa a duração do bloco, não a do serviço. */
  durationMinutesOverride?: number | null
  /** DEC-052: quem chama já move a etapa (ex.: bloco com nota própria). */
  skipStageMove?: boolean
  /** Nota do histórico ao ir para «Agendado». Padrão: confirmação no Agendar. */
  stageNote?: string | null
  /** DEC-051: duração escolhida no Agendar (validada contra mín/máx do serviço). */
  appliedDurationMinutes?: number | null
  /** DEC-078: zonas escolhidas. Obrigatório quando o serviço tem zonas ativas. */
  zoneIds?: string[] | null
  /**
   * Cópia já gravada na cobrança. O pagamento marca o mesmo bloco,
   * mesmo que o catálogo tenha mudado depois.
   */
  frozenZoneSnapshots?: ZoneSnapshot[] | null
  /** Combo já cobrado (DEC-080): vem da cobrança Pix junto com as variantes. */
  frozenCombo?: ComboSnapshot | null
  actorDisplayName?: string | null
}

export type CancelAppointmentInput = {
  clientRequestId: string
  appointmentId: string
  reason: AppointmentChangeReason
  actorClerkUserId: string
  /** Se informado e diferente da versão actual → conflito (TEL-06). */
  expectedVersion?: number | null
}

export type RescheduleAppointmentInput = {
  clientRequestId: string
  appointmentId: string
  reason: AppointmentChangeReason
  serviceId?: string
  professionalId: string
  roomResourceId?: string | null
  startsAt: number
  actorClerkUserId: string
  expectedVersion?: number | null
  /** DEC-078: troca o conjunto de zonas e revalida o bloco. Omitido: mantém a cópia. */
  zoneIds?: string[] | null
}

export type AppointmentDetail = AppointmentRow & {
  serviceName: string
  professionalName: string
  roomResourceName: string | null
  /** Cópia das zonas no momento da marcação (DEC-078). */
  zones: ZoneSnapshot[]
  events: AppointmentEventView[]
}

export type AppointmentEventView = {
  id: string
  operation: 'confirmed' | 'cancelled' | 'rescheduled'
  actorId: string | null
  reason: string | null
  previousJson: string | null
  newJson: string | null
  occurredAt: number
}

export type AppointmentListItem = {
  id: string
  serviceId: string
  serviceName: string
  professionalId: string
  professionalName: string
  roomResourceId: string | null
  roomResourceName: string | null
  startsAt: number
  endsAt: number
  occupiesUntil: number
  status: 'confirmed' | 'cancelled'
  contactLabel: string | null
  contactId: string | null
  conversationId: string | null
  opportunityId: string | null
  version: number
  changeReason: string | null
  /** DEC-051(i): duração aplicada ≠ padrão do serviço → rótulo «duração ajustada». */
  durationAdjusted: boolean
  /** Compromisso criado pela IA após confirmação explícita da cliente (28/10/2026). */
  bookedByAi: boolean
}

export type AgendaViewInput = {
  /** Data civil âncora YYYY-MM-DD no fuso da clínica. */
  date: string
  view: 'day' | 'week'
  professionalId?: string | null
  roomResourceId?: string | null
  /** Incluir cancelados (default false). */
  includeCancelled?: boolean
}

export type AgendaViewResult = {
  tenantId: string
  timezone: string
  view: 'day' | 'week'
  date: string
  rangeStartsAt: number
  rangeEndsAt: number
  asOf: number
  appointments: AppointmentListItem[]
  /** Reservas por bloco activas no intervalo (faixa «hora a definir»). */
  holds: ScheduleHoldView[]
}

export type SlotConflictDetails = {
  reasons: UnavailabilityReason[]
  conflictingAppointmentIds: string[]
  /** Compromisso anterior preservado (reagendar). */
  preservedAppointmentId?: string
  preservedStartsAt?: number
  preservedEndsAt?: number
}
