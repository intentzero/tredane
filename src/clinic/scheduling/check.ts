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
import { resourceBusyReasons, serviceOfferingAllows } from './occupancy'
import { candidateBreaksHolds } from './hold-fit'
import { resolveHomeRoom, resolveRequiredEquipment } from './query'
import { roomSexConflict } from './sex-block'
import type {
  AvailableSlot,
  CheckSlotInput,
  CheckSlotResult,
  UnavailabilityReason,
} from './types'

/**
 * Revalida um horário candidato (leitura pura).
 * Usado pela UI após mudança remota e pelo comando de confirmar (#36).
 * DEC-075 / S3: sala = home room da profissional, ou troca pontual em `roomResourceId`.
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

  // Troca pontual: roomResourceId no pedido; senão a sala da profissional.
  let roomId: string | null = input.roomResourceId ?? null
  let roomName: string | null = null
  let groupRoomId: string | null = null
  if (!roomId) {
    const home = resolveHomeRoom(db, tenantId, pro, clock)
    roomId = home?.id ?? null
  }

  if (!roomId) {
    reasons.push('room_required')
  } else {
    const room = getResource(db, tenantId, roomId, clock)
    if (!room || room.kind !== 'room' || !room.active) {
      throw new NotFoundError(
        'room_not_found',
        `sala ${roomId} não encontrada nesta clínica`,
      )
    }
    roomName = room.name
    // S4: modo grupo nesta sala.
    if (room.attendanceMode === 'uma_para_todas' && room.capacity > 1) {
      groupRoomId = room.id
    }
  }

  if (!serviceOfferingAllows(service.weeklyWindows, dayOfWeek, startMinute, occMins)) {
    reasons.push('outside_weekly_hours')
  }

  const allWindows = listEffectiveWeeklyWindows(db, tenantId)
  const proWindows = allWindows.filter((w) => w.resourceId === pro.id)
  reasons.push(
    ...resourceBusyReasons(
      db,
      tenantId,
      pro.id,
      proWindows,
      dayOfWeek,
      startMinute,
      occMins,
      range,
      dayEndsAt,
      input.excludeAppointmentId,
      groupRoomId,
    ),
  )

  if (
    !reasons.includes('outside_weekly_hours')
    && candidateBreaksHolds(
      db,
      tenantId,
      pro.id,
      range,
      { timezone, windows: proWindows, nowMs: asOf },
      {
        excludeAppointmentId: input.excludeAppointmentId,
        excludeHoldId: input.excludeHoldId,
      },
    )
  ) {
    reasons.push('hold_conflict')
  }

  if (roomId) {
    reasons.push(
      ...resourceBusyReasons(
        db,
        tenantId,
        roomId,
        // Sala/equipamento não tem expediente (decisão 28/10/2026).
        null,
        dayOfWeek,
        startMinute,
        occMins,
        range,
        dayEndsAt,
        input.excludeAppointmentId,
      ),
    )
    if (
      roomSexConflict(db, tenantId, roomId, range, service.audiencia, {
        excludeAppointmentId: input.excludeAppointmentId,
      })
    ) {
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
        dayOfWeek,
        startMinute,
        occMins,
        range,
        dayEndsAt,
        input.excludeAppointmentId,
      ),
    )
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
    slot,
    asOf,
    createdReservation: false,
  }
}
