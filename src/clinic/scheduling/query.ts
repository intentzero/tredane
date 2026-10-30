import type { Clock } from '../../db/clock'
import { NotFoundError, ValidationError } from '../errors'
import type { ClinicDb } from '../store'
import { listEffectiveWeeklyWindows } from '../config/availability'
import { computeConfigReadiness } from '../config/readiness'
import { getResource, listResources } from '../config/resources'
import { getService } from '../config/services'
import { ensureClinicSettings } from '../config/settings'
import { occupiedMinutes } from '../config/validation'
import type { ResourceRow, WeeklyWindowRow } from '../config/types'
import {
  clinicDayBounds,
  clinicDayOfWeek,
  slotStartUtc,
} from './timezone'
import {
  gridStartMinutes,
  listConfirmedOccupyingResource,
  peakConcurrentPeople,
  resourceBusyReasons,
  resourceCapacity,
  serviceOfferingAllows,
} from './occupancy'
import { candidateBreaksHolds } from './hold-fit'
import { roomSexConflict } from './sex-block'
import type {
  AvailabilityQueryInput,
  AvailabilityQueryResult,
  AvailableSlot,
  UnavailabilityReason,
} from './types'

function resolveProfessionals(
  db: ClinicDb,
  tenantId: string,
  serviceProfessionalIds: string[],
  filterId: string | null | undefined,
  clock: Clock,
): ResourceRow[] {
  const all = listResources(db, tenantId, clock).filter(
    (r) => r.kind === 'professional' && r.active,
  )
  const linked =
    serviceProfessionalIds.length === 0
      ? all
      : all.filter((r) => serviceProfessionalIds.includes(r.id))

  if (filterId && filterId !== 'any') {
    const one = linked.find((r) => r.id === filterId)
    if (!one) {
      const raw = getResource(db, tenantId, filterId, clock)
      if (!raw || raw.kind !== 'professional') {
        throw new NotFoundError(
          'professional_not_found',
          `profissional ${filterId} não encontrado nesta clínica`,
        )
      }
      throw new ValidationError(
        'professional_not_linked',
        'profissional não habilitado para este serviço',
        { professionalId: filterId },
      )
    }
    return [one]
  }
  return [...linked].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

/** Salas ativas da lista do serviço, primeira por nome (DEC-082). */
export function activeRoomsForService(
  db: ClinicDb,
  tenantId: string,
  service: NonNullable<ReturnType<typeof getService>>,
  clock: Clock,
): ResourceRow[] {
  if (service.roomRequirement.mode !== 'rooms') return []
  const rooms: ResourceRow[] = []
  for (const id of service.roomRequirement.resourceIds) {
    const room = getResource(db, tenantId, id, clock)
    if (room && room.kind === 'room' && room.active) rooms.push(room)
  }
  rooms.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id))
  return rooms
}

/** Equipamento exigido pelo serviço (DEC-059: uma vaga), à parte da lista de salas. */
export function resolveRequiredEquipment(
  db: ClinicDb,
  tenantId: string,
  service: NonNullable<ReturnType<typeof getService>>,
  clock: Clock,
): ResourceRow | null {
  if (!service.equipmentResourceId) return null
  const res = getResource(db, tenantId, service.equipmentResourceId, clock)
  if (!res || res.kind !== 'equipment' || !res.active) return null
  return res
}

/** Profissional (e sala, se houver) livres neste bloco. Lista vazia = cabe. */
export function placementBlockers(
  db: ClinicDb,
  tenantId: string,
  service: NonNullable<ReturnType<typeof getService>>,
  pro: ResourceRow,
  room: ResourceRow | null,
  ctx: {
    range: { startsAt: number; endsAt: number }
    dayOfWeek: number
    startMinute: number
    occMins: number
    dayEndsAt: number
    allWindows: WeeklyWindowRow[]
    asOf: number
    timezone: string
    excludeAppointmentId?: string | null
    excludeHoldId?: string | null
  },
  clock: Clock,
): UnavailabilityReason[] {
  const groupRoomId =
    room && room.attendanceMode === 'uma_para_todas' && room.capacity > 1 ? room.id : null
  const reasons: UnavailabilityReason[] = [
    ...resourceBusyReasons(
      db,
      tenantId,
      pro.id,
      windowsByResource(ctx.allWindows, pro.id),
      ctx.dayOfWeek,
      ctx.startMinute,
      ctx.occMins,
      ctx.range,
      ctx.dayEndsAt,
      ctx.excludeAppointmentId,
      groupRoomId,
      room?.id,
    ),
  ]
  if (
    !reasons.includes('outside_weekly_hours')
    && candidateBreaksHolds(
      db,
      tenantId,
      pro.id,
      ctx.range,
      { timezone: ctx.timezone, windows: windowsByResource(ctx.allWindows, pro.id), nowMs: ctx.asOf },
      { excludeAppointmentId: ctx.excludeAppointmentId, excludeHoldId: ctx.excludeHoldId },
    )
  ) {
    reasons.push('hold_conflict')
  }
  if (room) {
    reasons.push(
      ...resourceBusyReasons(
        db,
        tenantId,
        room.id,
        null,
        ctx.dayOfWeek,
        ctx.startMinute,
        ctx.occMins,
        ctx.range,
        ctx.dayEndsAt,
        ctx.excludeAppointmentId,
      ),
    )
    if (roomSexConflict(db, tenantId, room.id, ctx.range, service.audiencia, {
      excludeAppointmentId: ctx.excludeAppointmentId,
    })) {
      reasons.push('room_sex_mismatch')
    }
  }
  const requiredEquipment = resolveRequiredEquipment(db, tenantId, service, clock)
  if (requiredEquipment) {
    reasons.push(
      ...resourceBusyReasons(
        db,
        tenantId,
        requiredEquipment.id,
        null,
        ctx.dayOfWeek,
        ctx.startMinute,
        ctx.occMins,
        ctx.range,
        ctx.dayEndsAt,
        ctx.excludeAppointmentId,
      ),
    )
  }
  return [...new Set(reasons)]
}

function windowsByResource(
  all: WeeklyWindowRow[],
  resourceId: string,
): WeeklyWindowRow[] {
  return all.filter((w) => w.resourceId === resourceId)
}

/**
 * Consulta horários livres (leitura pura — nunca cria reserva).
 * Grade de 15 min no fuso da clínica; buffer ocupa profissional e sala (DEC-008).
 */
export function queryAvailability(
  db: ClinicDb,
  tenantId: string,
  input: AvailabilityQueryInput,
  clock: Clock,
): AvailabilityQueryResult {
  const settings = ensureClinicSettings(db, tenantId, clock)
  const timezone = settings.timezone
  const readiness = computeConfigReadiness(db, tenantId, clock)
  const asOf = clock.nowMs()

  const service = getService(db, tenantId, input.serviceId)
  if (!service || !service.active) {
    throw new NotFoundError(
      'service_not_found',
      `serviço ${input.serviceId} não encontrado ou inactivo nesta clínica`,
    )
  }

  const durationMinutes = input.durationMinutesOverride ?? service.durationMinutes
  const occMins = occupiedMinutes(durationMinutes, service.bufferMinutes)
  const { dayStartsAt, dayEndsAt, civil } = clinicDayBounds(timezone, input.date)
  const dayOfWeek = clinicDayOfWeek(timezone, dayStartsAt)

  const empty = (slots: AvailableSlot[]): AvailabilityQueryResult => ({
    tenantId,
    timezone,
    serviceId: service.id,
    serviceName: service.name,
    durationMinutes,
    bufferMinutes: service.bufferMinutes,
    occupiedMinutes: occMins,
    date: input.date,
    dayOfWeek,
    dayStartsAt,
    dayEndsAt,
    schedulingAllowed: readiness.schedulingAllowed,
    asOf,
    slots,
    createdReservation: false,
  })

  if (!readiness.schedulingAllowed) {
    return empty([])
  }

  const professionals = resolveProfessionals(
    db,
    tenantId,
    service.professionalIds,
    input.professionalId,
    clock,
  )
  if (professionals.length === 0) {
    return empty([])
  }

  const allWindows = listEffectiveWeeklyWindows(db, tenantId)
  const roomCandidates: Array<ResourceRow | null> =
    service.roomRequirement.mode === 'none'
      ? [null]
      : activeRoomsForService(db, tenantId, service, clock)
  const candidateStarts = gridStartMinutes(occMins)
  const slots: AvailableSlot[] = []

  for (const startMinute of candidateStarts) {
    const startsAt = slotStartUtc(timezone, civil, startMinute)
    const endsAt = startsAt + durationMinutes * 60_000
    const occupiesUntil = startsAt + occMins * 60_000
    const range = { startsAt, endsAt: occupiesUntil }

    // Horário cujo início já passou não é oferecido (início < agora).
    if (startsAt < asOf) continue

    if (!serviceOfferingAllows(service.weeklyWindows, dayOfWeek, startMinute, occMins)) {
      continue
    }

    let chosen: AvailableSlot | null = null

    for (const pro of professionals) {
      for (const room of roomCandidates) {
        const blockers = placementBlockers(
          db,
          tenantId,
          service,
          pro,
          room,
          {
            range,
            dayOfWeek,
            startMinute,
            occMins,
            dayEndsAt,
            allWindows,
            asOf,
            timezone,
            excludeHoldId: input.excludeHoldId,
          },
          clock,
        )
        if (blockers.length > 0) continue
        const roomCapacity = room ? resourceCapacity(db, tenantId, room.id) : 1
        const roomSeatsFree =
          room && roomCapacity > 1
            ? Math.max(
                0,
                roomCapacity
                  - peakConcurrentPeople(
                    range,
                    listConfirmedOccupyingResource(db, tenantId, room.id, range).map((a) => ({
                      startsAt: a.startsAt,
                      endsAt: a.occupiesUntil,
                      personKey: a.personKey,
                    })),
                  ),
              )
            : null
        chosen = {
          startsAt,
          endsAt,
          occupiesUntil,
          professionalId: pro.id,
          professionalName: pro.name,
          roomResourceId: room?.id ?? null,
          roomResourceName: room?.name ?? null,
          roomSharedNotice: room?.sharedSpaceNotice ?? null,
          roomCapacity: room && roomCapacity > 1 ? roomCapacity : null,
          roomSeatsFree,
        }
        break
      }
      if (chosen) break
    }

    if (chosen) slots.push(chosen)
  }

  const mode = input.tempoMode ?? 'equipe'
  const visible = mode === 'automatico'
    ? slots.filter((slot) => keepsTempo(service, slot.startsAt, input.tempoKeeps))
    : slots
  return empty(visible)
}

function keepsTempo(
  service: NonNullable<ReturnType<typeof getService>>,
  startsAt: number,
  keeps: ((startsAt: number) => boolean) | undefined,
): boolean {
  if (service.tempoCeu === 'tanto_faz' && service.tempoTemperatura === 'tanto_faz') return true
  if (!keeps) return false
  return keeps(startsAt)
}
