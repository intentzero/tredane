import type {
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
