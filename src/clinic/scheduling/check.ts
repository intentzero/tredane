import type { Clock } from '../../db/clock'
import { SCHEDULE_GRID_MINUTES } from '../constants'
import { NotFoundError } from '../errors'
import type { ClinicDb } from '../store'
import { listEffectiveWeeklyWindows } from '../config/availability'
import { computeConfigReadiness } from '../config/readiness'
import { getResource } from '../config/resources'
import { getService } from '../config/services'
import { ensureClinicSettings } from '../config/settings'
import { occupiedMinutes } from '../config/validation'
import {
  clinicCivilDateFromUtc,
  clinicDayBounds,
  clinicDayOfWeek,
  clinicMinuteOfDay,
} from './timezone'
import { serviceOfferingAllows } from './occupancy'
import { activeRoomsForService, placementBlockers } from './query'
import { currentRoomBlockSex, type BlockSex } from './sex-block'
import type {
  AvailableSlot,
  CheckSlotInput,
  CheckSlotResult,
  UnavailabilityReason,
} from './types'

/**
 * Revalida um horário candidato (leitura pura).
 * Usado pela UI após mudança remota e pelo comando de confirmar (#36).
 * DEC-082: sala = primeira livre da lista do serviço, ou a sala pedida se estiver nessa lista.
 */
export function checkSlotAvailability(
  db: ClinicDb,
  tenantId: string,
  input: CheckSlotInput,
  clock: Clock,
): CheckSlotResult {
  const asOf = clock.nowMs()
  const settings = ensureClinicSettings(db, tenantId, clock)
  const timezone = settings.timezone
  const readiness = computeConfigReadiness(db, tenantId, clock)
  const reasons: UnavailabilityReason[] = []

  if (!readiness.schedulingAllowed) {
    reasons.push('scheduling_not_allowed')
  }

  const service = getService(db, tenantId, input.serviceId)
  if (!service || !service.active) {
    // IDs de outra clínica / inexistentes — negar sem vazar dados.
    throw new NotFoundError(
      'service_not_found',
      `serviço ${input.serviceId} não encontrado ou inativo nesta clínica`,
    )
  }

  const durationMinutes = input.durationMinutesOverride ?? service.durationMinutes
  const occMins = occupiedMinutes(durationMinutes, service.bufferMinutes)
  const startsAt = input.startsAt
  const endsAt = startsAt + durationMinutes * 60_000
  const occupiesUntil = startsAt + occMins * 60_000
  const range = { startsAt, endsAt: occupiesUntil }

  // Marcar com início no passado é recusado (coerente com a consulta).
  if (startsAt < asOf) {
    reasons.push('past_slot')
  }

  const date = clinicCivilDateFromUtc(timezone, startsAt)
  const { dayEndsAt } = clinicDayBounds(timezone, date)
  const dayOfWeek = clinicDayOfWeek(timezone, startsAt)
  const startMinute = clinicMinuteOfDay(timezone, startsAt)

  if (startMinute % SCHEDULE_GRID_MINUTES !== 0) {
    reasons.push('invalid_grid')
  }

  const pro = getResource(db, tenantId, input.professionalId, clock)
  if (!pro || pro.kind !== 'professional' || !pro.active) {
    throw new NotFoundError(
      'professional_not_found',
      `profissional ${input.professionalId} não encontrado nesta clínica`,
    )
  }
  if (
    service.professionalIds.length > 0
    && !service.professionalIds.includes(pro.id)
  ) {
    reasons.push('professional_not_linked')
  }

  if (!serviceOfferingAllows(service.weeklyWindows, dayOfWeek, startMinute, occMins)) {
    reasons.push('outside_weekly_hours')
  }

  const allWindows = listEffectiveWeeklyWindows(db, tenantId)
  const place = {
    range,
    dayOfWeek,
    startMinute,
    occMins,
    dayEndsAt,
    allWindows,
    asOf,
    timezone,
    excludeAppointmentId: input.excludeAppointmentId,
    excludeHoldId: input.excludeHoldId,
  }
  let roomId: string | null = null
  let roomName: string | null = null
  let blockSex: BlockSex | null = null

  if (service.roomRequirement.mode === 'none') {
    if (input.roomResourceId) reasons.push('room_requirement_mismatch')
    else reasons.push(...placementBlockers(db, tenantId, service, pro, null, place, clock))
  } else if (input.roomResourceId) {
    if (!service.roomRequirement.resourceIds.includes(input.roomResourceId)) {
      reasons.push('room_requirement_mismatch')
    } else {
      const room = getResource(db, tenantId, input.roomResourceId, clock)
      if (!room || room.kind !== 'room' || !room.active) {
        reasons.push('room_unusable')
      } else {
        roomId = room.id
        roomName = room.name
        reasons.push(...placementBlockers(db, tenantId, service, pro, room, place, clock))
        blockSex = currentRoomBlockSex(db, tenantId, room.id, range, {
          excludeAppointmentId: input.excludeAppointmentId,
        })
      }
    }
  } else {
    const rooms = activeRoomsForService(db, tenantId, service, clock)
    if (rooms.length === 0) {
      reasons.push('room_required')
    } else {
      let first: UnavailabilityReason[] | null = null
      for (const room of rooms) {
        const blockers = placementBlockers(db, tenantId, service, pro, room, place, clock)
        if (blockers.length === 0) {
          roomId = room.id
          roomName = room.name
          break
        }
        if (!first) first = blockers
      }
      if (!roomId && first) reasons.push(...first)
      const sexRoomId = roomId ?? rooms[0]?.id
      if (sexRoomId) {
        blockSex = currentRoomBlockSex(db, tenantId, sexRoomId, range, {
          excludeAppointmentId: input.excludeAppointmentId,
        })
      }
    }
  }

  const unique = [...new Set(reasons)]
  const available = unique.length === 0
  const slot: AvailableSlot | null = available
    ? {
        startsAt,
        endsAt,
        occupiesUntil,
        professionalId: pro.id,
        professionalName: pro.name,
        roomResourceId: roomId,
        roomResourceName: roomName,
      }
    : null

  return {
    available,
    reasons: unique,
    blockSex: unique.includes('room_sex_mismatch') ? blockSex : null,
    slot,
    asOf,
    createdReservation: false,
  }
}
