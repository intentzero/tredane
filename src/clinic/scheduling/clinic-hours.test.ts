/**
 * Horário da clínica com herança e fechamentos da clínica inteira
 * (Proposto, 28/10/2026; ux-ui.md TEL-09).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  createBlockOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { computeConfigReadiness } from '../config/readiness'
import { CLINIC_SCOPE_ID } from '../config/types'
import { queryAvailabilityOp, zonedCivilToUtc } from './index'

const MONDAY = '2024-01-08'
const TZ = 'America/Sao_Paulo'
const at = (h: number, m = 0) => zonedCivilToUtc(TZ, 2024, 1, 8, h, m)

function seed() {
  const clock = createControllableClock(Date.UTC(2024, 0, 1))
  const boot = bootClinicDb({ clock })
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const sharedRoom = upsertResourceOp(boot.db, caller, { kind: 'room', name: 'Sala comum' }, clock)
  const mk = (name: string, extra: Record<string, unknown> = {}) =>
    upsertResourceOp(
      boot.db,
      caller,
      { kind: 'professional', name, homeRoomId: sharedRoom.id, ...extra },
      clock,
    )
  const svcFor = (ids: string[]) =>
    upsertServiceOp(
      boot.db,
      caller,
      { name: 'Limpeza', durationMinutes: 60, bufferMinutes: 0, professionalIds: ids, roomRequirement: { mode: 'none' } },
      clock,
    )
  const clinicHours = (startH: number, endH: number) =>
    setWeeklyWindowsOp(
      boot.db,
      caller,
      { resourceId: CLINIC_SCOPE_ID, windows: [{ dayOfWeek: 1, startMinute: startH * 60, endMinute: endH * 60 }] },
      clock,
    )
  return { ...boot, clock, caller, mk, svcFor, clinicHours }
}

describe('horário da clínica', () => {
  it('profissional que segue a clínica muda junto; a de horário próprio não', () => {
    const s = seed()
    try {
      s.clinicHours(8, 12)
      const follower = s.mk('Ana')
      expect(follower.hoursMode).toBe('clinic') // padrão: segue a clínica quando ela já tem horário
      const own = s.mk('Bia', { hoursMode: 'own' })
      setWeeklyWindowsOp(
        s.db,
        s.caller,
        { resourceId: own.id, windows: [{ dayOfWeek: 1, startMinute: 14 * 60, endMinute: 18 * 60 }] },
        s.clock,
      )
      const svc = s.svcFor([follower.id, own.id])
      const avail = queryAvailabilityOp(s.db, s.caller, { serviceId: svc.id, date: MONDAY }, s.clock)
      expect(avail.slots.some((x) => x.professionalId === follower.id && x.startsAt === at(8))).toBe(true)
      expect(avail.slots.some((x) => x.professionalId === own.id && x.startsAt === at(14))).toBe(true)
      expect(avail.slots.some((x) => x.professionalId === own.id && x.startsAt === at(8))).toBe(false)

      // Muda o expediente da clínica: só quem segue acompanha.
      s.clinicHours(13, 17)
      const onlyFollower = queryAvailabilityOp(
        s.db, s.caller, { serviceId: svc.id, date: MONDAY, professionalId: follower.id }, s.clock,
      )
      expect(onlyFollower.slots.some((x) => x.startsAt === at(8))).toBe(false)
      expect(onlyFollower.slots.some((x) => x.startsAt === at(13))).toBe(true)
      const onlyOwn = queryAvailabilityOp(
        s.db, s.caller, { serviceId: svc.id, date: MONDAY, professionalId: own.id }, s.clock,
      )
      expect(onlyOwn.slots.some((x) => x.startsAt === at(14))).toBe(true)
      expect(onlyOwn.slots.some((x) => x.startsAt === at(8))).toBe(false)
    } finally {
      s.close()
    }
  })

  it('sem horário da clínica a nova profissional começa com horário próprio; hoursMode só vale para profissional', () => {
    const s = seed()
    try {
      expect(s.mk('Ana').hoursMode).toBe('own')
      expect(() =>
        upsertResourceOp(s.db, s.caller, { kind: 'room', name: 'Sala 1', hoursMode: 'clinic' }, s.clock),
      ).toThrow(/profissional/)
    } finally {
      s.close()
    }
  })

  it('«pronta» conta a profissional que segue o horário da clínica', () => {
    const s = seed()
    try {
      s.mk('Ana', { hoursMode: 'clinic' })
      s.svcFor([])
      expect(computeConfigReadiness(s.db, 'clinic-demo-a', s.clock).missing).toContain('weekly_availability')
      s.clinicHours(8, 12)
      expect(computeConfigReadiness(s.db, 'clinic-demo-a', s.clock).missing).not.toContain('weekly_availability')
    } finally {
      s.close()
    }
  })
})

describe('fechamento da clínica inteira', () => {
  it('um fechamento esconde os horários de todos e o impacto lista os compromissos de todos', () => {
    const s = seed()
    try {
      s.clinicHours(8, 18)
      const a = s.mk('Ana')
      const b = s.mk('Bia')
      const svc = s.svcFor([a.id, b.id])
      const dry = createBlockOp(
        s.db,
        s.caller,
        { resourceId: CLINIC_SCOPE_ID, startsAt: at(0), endsAt: at(23, 59), reason: 'feriado', dryRun: true },
        s.clock,
      )
      expect(dry.created).toBe(false)
      expect(dry.affectedAppointments).toHaveLength(0)
      const made = createBlockOp(
        s.db,
        s.caller,
        { resourceId: CLINIC_SCOPE_ID, startsAt: at(0), endsAt: at(23, 59), reason: 'feriado' },
        s.clock,
      )
      expect(made.created).toBe(true)
      const avail = queryAvailabilityOp(s.db, s.caller, { serviceId: svc.id, date: MONDAY }, s.clock)
      expect(avail.slots).toHaveLength(0)
    } finally {
      s.close()
    }
  })

  it('bloqueio com período de vários dias vale para a profissional', () => {
    const s = seed()
    try {
      s.clinicHours(8, 18)
      const a = s.mk('Ana')
      const svc = s.svcFor([a.id])
      createBlockOp(
        s.db,
        s.caller,
        { resourceId: a.id, startsAt: at(0) - 24 * 3_600_000, endsAt: at(23, 59) + 24 * 3_600_000, reason: 'ferias' },
        s.clock,
      )
      const avail = queryAvailabilityOp(s.db, s.caller, { serviceId: svc.id, date: MONDAY }, s.clock)
      expect(avail.slots).toHaveLength(0)
    } finally {
      s.close()
    }
  })
})
