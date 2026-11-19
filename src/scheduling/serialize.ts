import type { ScheduleHoldView } from '../clinic/scheduling'
import {
  APPOINTMENT_CHANGE_REASONS,
  APPOINTMENT_CHANGE_REASON_LABELS,
} from '../clinic/constants'
import type {
  AgendaViewResult,
  AppointmentDetail,
  AppointmentListItem,
  AvailabilityQueryResult,
  CheckSlotResult,
} from '../clinic/scheduling'

export function serializeAvailability(result: AvailabilityQueryResult) {
  return {
    tenantId: result.tenantId,
    timezone: result.timezone,
    serviceId: result.serviceId,
    serviceName: result.serviceName,
    durationMinutes: result.durationMinutes,
    bufferMinutes: result.bufferMinutes,
    occupiedMinutes: result.occupiedMinutes,
    date: result.date,
    dayOfWeek: result.dayOfWeek,
    dayStartsAt: result.dayStartsAt,
    dayEndsAt: result.dayEndsAt,
    schedulingAllowed: result.schedulingAllowed,
    asOf: result.asOf,
    createdReservation: result.createdReservation,
    slots: result.slots.map((s) => ({
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      occupiesUntil: s.occupiesUntil,
      professionalId: s.professionalId,
      professionalName: s.professionalName,
      roomResourceId: s.roomResourceId,
      roomResourceName: s.roomResourceName,
      roomSharedNotice: s.roomSharedNotice ?? null,
      roomCapacity: s.roomCapacity ?? null,
      roomSeatsFree: s.roomSeatsFree ?? null,
      tempoWarnings: s.tempoWarnings ?? [],
    })),
  }
}

export function serializeCheckSlot(result: CheckSlotResult) {
  return {
    available: result.available,
    reasons: result.reasons,
    asOf: result.asOf,
    createdReservation: result.createdReservation,
    slot: result.slot
      ? {
          startsAt: result.slot.startsAt,
          endsAt: result.slot.endsAt,
          occupiesUntil: result.slot.occupiesUntil,
          professionalId: result.slot.professionalId,
          professionalName: result.slot.professionalName,
          roomResourceId: result.slot.roomResourceId,
          roomResourceName: result.slot.roomResourceName,
        }
      : null,
  }
}

function agendaFirstName(label: string | null | undefined): string | null {
  const trimmed = label?.trim()
  if (!trimmed) return null
  return trimmed.split(/\s+/)[0] || null
}

function serializeListItem(item: AppointmentListItem, professionalView = false) {
  return {
    id: item.id,
    serviceId: item.serviceId,
    serviceName: item.serviceName,
    professionalId: item.professionalId,
    professionalName: item.professionalName,
    roomResourceId: item.roomResourceId,
    roomResourceName: item.roomResourceName,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    occupiesUntil: item.occupiesUntil,
    status: item.status,
    contactLabel: professionalView ? agendaFirstName(item.contactLabel) : item.contactLabel,
    contactId: professionalView ? null : item.contactId,
    conversationId: professionalView ? null : item.conversationId,
    opportunityId: professionalView ? null : item.opportunityId,
    version: item.version,
    changeReason: item.changeReason,
    durationAdjusted: item.durationAdjusted,
    bookedByAi: item.bookedByAi,
  }
}

export function serializeAppointmentDetail(detail: AppointmentDetail) {
  return {
    id: detail.id,
    tenantId: detail.tenantId,
    serviceId: detail.serviceId,
    serviceName: detail.serviceName,
    professionalId: detail.professionalId,
    professionalName: detail.professionalName,
    roomResourceId: detail.roomResourceId,
    roomResourceName: detail.roomResourceName,
    startsAt: detail.startsAt,
    endsAt: detail.endsAt,
    occupiesUntil: detail.occupiesUntil,
    defaultDurationMinutes: detail.defaultDurationMinutes,
    appliedDurationMinutes: detail.appliedDurationMinutes,
    status: detail.status,
    contactLabel: detail.contactLabel,
    contactId: detail.contactId,
    conversationId: detail.conversationId,
    opportunityId: detail.opportunityId,
    version: detail.version,
    updatedAt: detail.updatedAt,
    confirmedBy: detail.confirmedBy,
    confirmedAt: detail.confirmedAt,
    changeReason: detail.changeReason,
    cancelledBy: detail.cancelledBy,
    cancelledAt: detail.cancelledAt,
    createdAt: detail.createdAt,
    events: detail.events.map((e) => ({
      id: e.id,
      operation: e.operation,
      actorId: e.actorId,
      reason: e.reason,
      previousJson: e.previousJson,
      newJson: e.newJson,
      occurredAt: e.occurredAt,
    })),
    zones: detail.zones.map((z) => ({
      zoneId: z.zoneId,
      name: z.name,
      audience: z.audience,
      durationMinutes: z.durationMinutes,
      priceCents: z.priceCents,
    })),
  }
}

export function serializeAgendaView(
  result: AgendaViewResult,
  opts?: { professionalView?: boolean },
) {
  const professionalView = opts?.professionalView === true
  return {
    tenantId: result.tenantId,
    timezone: result.timezone,
    view: result.view,
    date: result.date,
    rangeStartsAt: result.rangeStartsAt,
    rangeEndsAt: result.rangeEndsAt,
    asOf: result.asOf,
    appointments: result.appointments.map((item) => serializeListItem(item, professionalView)),
    holds: result.holds.map((hold) => {
      const row = serializeHold(hold)
      if (!professionalView) return row
      return {
        ...row,
        contactName: agendaFirstName(row.contactName),
        contactId: null,
        conversationId: null,
        opportunityId: null,
      }
    }),
    availability: result.availability,
  }
}

/** Reserva por bloco — campos explícitos (sem client_request_id). */
export function serializeHold(h: ScheduleHoldView) {
  return {
    id: h.id,
    status: h.status,
    opportunityId: h.opportunityId,
    conversationId: h.conversationId,
    contactId: h.contactId,
    contactName: h.contactName,
    serviceId: h.serviceId,
    serviceName: h.serviceName,
    professionalId: h.professionalId,
    professionalName: h.professionalName,
    durationMinutes: h.durationMinutes,
    windowStartsAt: h.windowStartsAt,
    windowEndsAt: h.windowEndsAt,
    confirmBy: h.confirmBy,
    appointmentId: h.appointmentId,
    responsibleClerkUserId: h.responsibleClerkUserId,
    responsibleDisplayName: h.responsibleDisplayName,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
    resolvedAt: h.resolvedAt,
    expiredAt: h.expiredAt,
    cancelledAt: h.cancelledAt,
    alertDismissedAt: h.alertDismissedAt,
  }
}

export function serializeChangeReasons() {
  return APPOINTMENT_CHANGE_REASONS.map((code) => ({
    code,
    label: APPOINTMENT_CHANGE_REASON_LABELS[code],
  }))
}
