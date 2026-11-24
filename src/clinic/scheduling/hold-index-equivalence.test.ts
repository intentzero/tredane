import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { listEffectiveWeeklyWindows } from '../config/availability'
import { candidateBreaksHolds } from './hold-fit'
import { createOccupancyDayIndex } from './occupancy'
import { clinicDayBounds } from './timezone'
import { createHoldOp, zonedCivilToUtc } from './index'

const TZ = 'America/Sao_Paulo'
const ACTOR = 'user_synth_owner_a'
const TENANT = 'clinic-demo-a'
const at = (h: number, m = 0) => zonedCivilToUtc(TZ, 2024, 1, 8, h, m)

describe('candidateBreaksHolds: ler os holds do dia uma vez dá o mesmo que a leitura por hora', () => {
  it('mesmo veredicto em todas as horas, e há horas em que o hold quebra mesmo', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 5, 12))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller(TENANT, ACTOR)
      const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala' }, clock)
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Ana', homeRoomId: room.id }, clock)
      const monday = [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 12 * 60 }]
      for (const id of [pro.id, room.id]) setWeeklyWindowsOp(db, caller, { resourceId: id, windows: monday }, clock)
      const svc = upsertServiceOp(
        db,
        caller,
        { name: 'Limpeza', durationMinutes: 60, bufferMinutes: 0, professionalIds: [pro.id], roomRequirement: { mode: 'none' } },
        clock,
      )
      const conv = ingestContactMessage(
        db,
        workerCaller(TENANT),
        { providerEventKey: 'wa:hold:eq', waId: '5511999990002', displayName: 'Marina', body: 'Oi' },
        clock,
      ).conversation!
      // Bloco de 60 min algures entre 8:00 e 12:00, com a hora marcada às 8:00.
      const created = createHoldOp(
        db,
        caller,
        {
          clientRequestId: 'h-eq',
          conversationId: conv.id,
          serviceId: svc.id,
          professionalId: pro.id,
          durationMinutes: 60,
          windowStartsAt: at(8),
          windowEndsAt: at(12),
          startsAt: at(8),
          actorClerkUserId: ACTOR,
          actorDisplayName: 'Atendente',
        },
        clock,
      )
      const ctx = {
        timezone: TZ,
        windows: listEffectiveWeeklyWindows(db, TENANT).filter((w) => w.resourceId === pro.id),
        nowMs: clock.nowMs(),
      }
      const day = clinicDayBounds(TZ, '2024-01-08')
      const opts = { excludeAppointmentId: created.value.appointment.id }

      // Desde «sempre com hora» o bloco nasce `resolved`; forçamos `active` para exercitar o caminho
      // que a cache toca (um bloco ainda por resolver, com a hora marcada a ser excluída).
      db.run("UPDATE schedule_holds SET status = 'active' WHERE tenant_id = ?", TENANT)
      let breaks = 0
      for (const minutes of [60, 120, 150, 180, 210]) {
        const index = createOccupancyDayIndex({ startsAt: day.dayStartsAt, endsAt: day.dayEndsAt })
        for (let m = 0; m < 24 * 60; m += 15) {
          const candidate = { startsAt: at(0, m), endsAt: at(0, m + minutes) }
          const direct = candidateBreaksHolds(db, TENANT, pro.id, candidate, ctx, opts)
          const cached = candidateBreaksHolds(db, TENANT, pro.id, candidate, ctx, { ...opts, index })
          expect(cached, `${minutes} min às ${m / 60}h`).toBe(direct)
          if (direct) breaks += 1
        }
      }
      // Sem conflitos reais o teste não provava nada.
      expect(breaks).toBeGreaterThan(0)
    } finally {
      close()
    }
  })
})
