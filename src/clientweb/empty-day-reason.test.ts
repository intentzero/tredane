import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { workerCaller } from '../clinic'
import { bootClinicDb } from '../clinic/test-db'
import { createBlockOp, setWeeklyWindowsOp, upsertResourceOp } from '../clinic/config'
import { CLINIC_SCOPE_ID } from '../clinic/config/types'
import { zonedCivilToUtc } from '../clinic/scheduling/timezone'
import { classifyEmptyDayReason, emptyDaysForRange } from './empty-day-reason'
import { listProfessionalOpeningWindows } from '../clinic/ai/opening-source'

const TENANT = 'clinic-demo-a'
const TZ = 'America/Sao_Paulo'

describe('empty-day-reason (TRE-33)', () => {
  it('classifica domingo sem expediente como closed e segunda cheia como full', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 7, 15))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller(TENANT, 'user_synth_owner_a')
      const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Paula', homeRoomId: room.id }, clock)
      setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }] }, clock)
      const windows = listProfessionalOpeningWindows(db, TENANT, clock)
      expect(classifyEmptyDayReason(db, TENANT, '2024-01-07', TZ, windows)).toBe('closed')
      expect(classifyEmptyDayReason(db, TENANT, '2024-01-08', TZ, windows)).toBe('full')
      expect(emptyDaysForRange(db, TENANT, clock, TZ, ['2024-01-07', '2024-01-08'])).toEqual([
        { date: '2024-01-07', reason: 'closed' },
        { date: '2024-01-08', reason: 'full' },
      ])
    } finally {
      close()
    }
  })

  it('bloqueio __clinic__ no dia civil conta como closed sem devolver o nome', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 7, 15))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller(TENANT, 'user_synth_owner_a')
      const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Paula', homeRoomId: room.id }, clock)
      setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }] }, clock)
      const start = zonedCivilToUtc(TZ, 2024, 1, 8, 0, 0)
      const end = zonedCivilToUtc(TZ, 2024, 1, 9, 0, 0)
      createBlockOp(
        db,
        caller,
        { resourceId: CLINIC_SCOPE_ID, startsAt: start, endsAt: end, reason: 'feriado', note: 'Dia da Consciência Negra' },
        clock,
      )
      const windows = listProfessionalOpeningWindows(db, TENANT, clock)
      expect(classifyEmptyDayReason(db, TENANT, '2024-01-08', TZ, windows)).toBe('closed')
    } finally {
      close()
    }
  })
})
