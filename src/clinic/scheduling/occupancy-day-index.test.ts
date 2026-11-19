/**
 * Baseline staging 15/11 P2: DO CPU ao confirmar/ecoar zonas (ex. depilação axila+pernas).
 * `queryAvailability` chamava `listConfirmedOccupyingResource` em cada célula da grade
 * (N×SQL na agenda cheia da demo). Índice por recurso/dia + filtro SQL no intervalo.
 */
import { describe, expect, it, vi } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { insertSyntheticAppointment, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import * as occupancy from './occupancy'
import { queryAvailability } from './query'

/** Segunda 2026-11-16 10:00 SP — alinhado ao cenário S03a (dia útil após domingo 15/11). */
const NOW = Date.UTC(2026, 10, 16, 13, 0)

function seedBusyClinic() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-occupancy-cpu'
  const caller = workerCaller(tenantId, 'user_synth_owner_cpu')
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala dep', category: 'dep' }, clock)
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Pro demo', homeRoomId: room.id },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: 8000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
    },
    clock,
  )
  const week = [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1140 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)

  // Agenda densa (~2 semanas), semelhante ao seed demo.
  const dayMs = 86_400_000
  const spOffset = 3 * 3_600_000
  const dayIndex = Math.floor((NOW - spOffset) / dayMs)
  const monday = dayIndex - ((new Date(NOW).getUTCDay() + 6) % 7)
  let n = 0
  for (let d = monday; d < monday + 14; d++) {
    const dow = new Date(d * dayMs).getUTCDay()
    if (dow === 0) continue
    for (let minute = 540; minute < 1080; minute += 30) {
      if ((d + minute) % 5 === 0) continue
      const startsAt = d * dayMs + minute * 60_000 + spOffset
      insertSyntheticAppointment(
        db,
        tenantId,
        {
          id: `apt_cpu_${d}_${minute}`,
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt,
          endsAt: startsAt + 25 * 60_000,
          contactLabel: `Paciente ${n++}`,
          status: 'confirmed',
        },
        clock,
      )
    }
  }
  return { ...boot, clock, tenantId, svc, db }
}

describe('occupancy day index (agenda cheia)', () => {
  it('queryAvailability com 2 zonas (duração longa) faz SQL de ocupação O(recursos), não O(grade)', () => {
    const s = seedBusyClinic()
    try {
      const spy = vi.spyOn(occupancy, 'listConfirmedOccupyingResource')
      const date = '2026-11-17'
      const twoZonesMinutes = 45
      const result = queryAvailability(
        s.db,
        s.tenantId,
        { serviceId: s.svc.id, date, durationMinutesOverride: twoZonesMinutes },
        s.clock,
      )
      expect(result.slots.length).toBeGreaterThan(0)
      // pro + sala no máximo duas cargas por dia (índice), não centenas.
      expect(spy.mock.calls.length).toBeLessThanOrEqual(4)
    } finally {
      s.close()
    }
  })
})