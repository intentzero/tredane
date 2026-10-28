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
  peakConcurrent,
  resourceBusyReasons,
  resourceCapacity,
} from './occupancy'
import { candidateBreaksHolds, listActiveHoldNeeds } from './hold-fit'
import type {
  AvailabilityQueryInput,
  AvailabilityQueryResult,
  AvailableSlot,
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

function resolveRooms(
  db: ClinicDb,
  tenantId: string,
  service: NonNullable<ReturnType<typeof getService>>,
  clock: Clock,
): ResourceRow[] {
  const req = service.roomRequirement
  if (req.mode === 'none') return []

  const rooms = listResources(db, tenantId, clock).filter(
    (r) => (r.kind === 'room' || r.kind === 'equipment') && r.active,
  )

  if (req.mode === 'resource') {
    const one = rooms.find((r) => r.id === req.resourceId)
    if (!one) {
      throw new ValidationError(
        'room_unusable',
        'sala/equipamento exigido inactivo ou inexistente',
        { resourceId: req.resourceId },
      )
    }
    return [one]
  }

  if (req.mode === 'any') {
    const all = [...rooms].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    if (all.length === 0) {
      throw new ValidationError(
        'room_unusable',
        'nenhuma sala/equipamento activo',
        {},
      )
    }
    return all
  }

  const matched = rooms
    .filter((r) => r.category === req.category)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  if (matched.length === 0) {
    throw new ValidationError(
      'room_unusable',
      `nenhuma sala/equipamento activo na categoria ${req.category}`,
      { category: req.category },
    )
  }
  return matched
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

  let rooms: ResourceRow[]
  try {
    rooms = resolveRooms(db, tenantId, service, clock)
  } catch (err) {
    if (err instanceof ValidationError) return empty([])
    throw err
  }

  const needsRoom = service.roomRequirement.mode !== 'none'
  if (needsRoom && rooms.length === 0) {
    return empty([])
  }

  const allWindows = listEffectiveWeeklyWindows(db, tenantId)
  const prosWithHolds = new Set(
    professionals
      .filter(
        (p) =>
          listActiveHoldNeeds(
            db,
            tenantId,
            p.id,
            { startsAt: dayStartsAt, endsAt: dayEndsAt },
            asOf,
            input.excludeHoldId,
          ).length > 0,
      )
      .map((p) => p.id),
  )
  const candidateStarts = gridStartMinutes(occMins)
  const slots: AvailableSlot[] = []

  for (const startMinute of candidateStarts) {
    const startsAt = slotStartUtc(timezone, civil, startMinute)
    const endsAt = startsAt + durationMinutes * 60_000
    const occupiesUntil = startsAt + occMins * 60_000
    const range = { startsAt, endsAt: occupiesUntil }

    // Horário cujo início já passou não é oferecido (início < agora).
    if (startsAt < asOf) continue

    let chosen: AvailableSlot | null = null

    for (const pro of professionals) {
      const proReasons = resourceBusyReasons(
        db,
        tenantId,
        pro.id,
        windowsByResource(allWindows, pro.id),
        dayOfWeek,
        startMinute,
        occMins,
        range,
        dayEndsAt,
      )
      if (proReasons.length > 0) continue
      if (
        prosWithHolds.has(pro.id)
        && candidateBreaksHolds(
          db,
          tenantId,
          pro.id,
          range,
          { timezone, windows: windowsByResource(allWindows, pro.id), nowMs: asOf },
          { excludeHoldId: input.excludeHoldId },
        )
      ) {
        continue
      }

      if (!needsRoom) {
        chosen = {
          startsAt,
          endsAt,
          occupiesUntil,
          professionalId: pro.id,
          professionalName: pro.name,
          roomResourceId: null,
          roomResourceName: null,
        }
        break
      }

      for (const room of rooms) {
        const roomReasons = resourceBusyReasons(
          db,
          tenantId,
          room.id,
          // Sala/equipamento não tem expediente (decisão 28/10/2026).
          null,
          dayOfWeek,
          startMinute,
          occMins,
          range,
          dayEndsAt,
        )
        if (roomReasons.length > 0) continue
        // Sala compartilhada: lugares livres no pico do período (só para exibição).
        const roomCapacity = resourceCapacity(db, tenantId, room.id)
        const roomSeatsFree =
          roomCapacity > 1
            ? Math.max(
                0,
                roomCapacity
                  - peakConcurrent(
                    range,
                    listConfirmedOccupyingResource(db, tenantId, room.id, range).map((a) => ({
                      startsAt: a.startsAt,
                      endsAt: a.occupiesUntil,
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
          roomResourceId: room.id,
          roomResourceName: room.name,
          roomSharedNotice: room.sharedSpaceNotice,
          roomCapacity: roomCapacity > 1 ? roomCapacity : null,
          roomSeatsFree,
        }
        break
      }
      if (chosen) break
    }

    if (chosen) slots.push(chosen)
  }

  return empty(slots)
}
