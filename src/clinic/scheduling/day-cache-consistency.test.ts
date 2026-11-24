import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { createBlockOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { CLINIC_SCOPE_ID } from '../config/types'
import {
  checkSlotAvailabilityOp,
  confirmAppointmentOp,
  createHoldOp,
  queryAvailabilityOp,
  zonedCivilToUtc,
} from './index'

const TZ = 'America/Sao_Paulo'
const ACTOR = 'user_synth_owner_a'
const TENANT = 'clinic-demo-a'
const at = (h: number, m = 0) => zonedCivilToUtc(TZ, 2024, 1, 8, h, m)

/**
 * O motor de horas lê bloqueios, holds e dados da sala uma vez por dia (cache) e poda as horas
 * fora do expediente. `checkSlotAvailability` não usa nada disto: tem de dar o mesmo veredicto
 * em todas as horas da grade, com bloqueios, hold, marcações e sala partilhada à mistura.
 */
describe('cache por dia do motor de horas = verificação hora a hora', () => {
  it('queryAvailability e checkSlotAvailability concordam em todas as 96 horas do dia', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 5, 12))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller(TENANT, ACTOR)
      const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', capacity: 2 }, clock)
      const ana = upsertResourceOp(db, caller, { kind: 'professional', name: 'Ana', homeRoomId: room.id }, clock)
      const bia = upsertResourceOp(db, caller, { kind: 'professional', name: 'Bia', homeRoomId: room.id }, clock)
      const monday = [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }]
      for (const id of [ana.id, bia.id, room.id]) setWeeklyWindowsOp(db, caller, { resourceId: id, windows: monday }, clock)
      // Bia só trabalha de manhã: as horas da tarde são só da Ana.
      setWeeklyWindowsOp(db, caller, { resourceId: bia.id, windows: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 12 * 60 }] }, clock)
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Limpeza',
          durationMinutes: 60,
          bufferMinutes: 15,
          professionalIds: [ana.id, bia.id],
          roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
        },
        clock,
      )
      const conv = ingestContactMessage(
        db,
        workerCaller(TENANT),
        { providerEventKey: 'wa:cache:1', waId: '5511999990001', displayName: 'Marina', body: 'Oi' },
        clock,
      ).conversation!

      // Bloqueio da Ana 10:00–11:00 e da clínica inteira 15:00–15:30; marcação da Bia às 9:00;
      // bloco (hold) da Ana entre 12:00 e 14:00 com a hora marcada às 12:00.
      createBlockOp(db, caller, { resourceId: ana.id, startsAt: at(10), endsAt: at(11), reason: 'outro' }, clock)
      createBlockOp(db, caller, { resourceId: CLINIC_SCOPE_ID, startsAt: at(15), endsAt: at(15, 30), reason: 'outro' }, clock)
      confirmAppointmentOp(db, caller, { clientRequestId: 'a1', serviceId: svc.id, professionalId: bia.id, startsAt: at(9), actorClerkUserId: ACTOR }, clock)
      createHoldOp(
        db,
        caller,
        {
          clientRequestId: 'h1',
          conversationId: conv.id,
          serviceId: svc.id,
          professionalId: ana.id,
          durationMinutes: 60,
          windowStartsAt: at(12),
          windowEndsAt: at(14),
          startsAt: at(12),
          actorClerkUserId: ACTOR,
          actorDisplayName: 'Atendente',
        },
        clock,
      )

      for (const [label, professionalId] of [['Ana', ana.id], ['Bia', bia.id]] as const) {
        const offered = new Set(
          queryAvailabilityOp(db, caller, { serviceId: svc.id, date: '2024-01-08', professionalId }, clock).slots.map(
            (s) => s.startsAt,
          ),
        )
        let agreed = 0
        let freeCount = 0
        for (let m = 0; m < 24 * 60; m += 15) {
          const startsAt = at(0, m)
          const check = checkSlotAvailabilityOp(db, caller, { serviceId: svc.id, professionalId, startsAt }, clock)
          expect(offered.has(startsAt), `${label} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`).toBe(check.available)
          agreed += 1
          if (check.available) freeCount += 1
        }
        expect(agreed).toBe(96)
        // O cenário tem de ter horas livres e ocupadas, senão o teste não prova nada.
        expect(freeCount).toBeGreaterThan(0)
        expect(freeCount).toBeLessThan(40)
      }
    } finally {
      close()
    }
  })
})
