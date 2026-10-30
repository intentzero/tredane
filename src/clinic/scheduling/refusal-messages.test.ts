/**
 * DEC-075 / S6 — frases fixas de recusa (sala cheia, outra sala, sexo).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ConflictError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import {
  checkSlotAvailabilityOp,
  confirmAppointmentOp,
  REFUSAL_PRO_OTHER_ROOM,
  REFUSAL_ROOM_FULL,
  REFUSAL_SEX_FEMININO,
  REFUSAL_SEX_MASCULINO,
  refusalMessageForReasons,
  zonedCivilToUtc,
} from './index'

const TZ = 'America/Sao_Paulo'
const at = (h: number, m = 0) => zonedCivilToUtc(TZ, 2024, 1, 8, h, m)
const DAY = { dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }

describe('S6 — textos de recusa', () => {
  it('frases fixas sem quantidade nem Permitir os dois', () => {
    expect(refusalMessageForReasons(['room_at_capacity'])).toBe(REFUSAL_ROOM_FULL)
    expect(refusalMessageForReasons(['professional_other_room'])).toBe(
      REFUSAL_PRO_OTHER_ROOM,
    )
    expect(refusalMessageForReasons(['room_sex_mismatch'], 'feminino')).toBe(
      REFUSAL_SEX_FEMININO,
    )
    expect(refusalMessageForReasons(['room_sex_mismatch'], 'masculino')).toBe(
      REFUSAL_SEX_MASCULINO,
    )
    expect(REFUSAL_ROOM_FULL).not.toMatch(/\d/)
    expect(REFUSAL_SEX_FEMININO).not.toMatch(/Permitir os dois/i)
  })

  it('sala cheia e profissional noutra sala devolvem frases distintas', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const boot = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const sala = upsertResourceOp(
        boot.db,
        caller,
        { kind: 'room', name: 'Salão', capacity: 2, attendanceMode: 'cada_profissional' },
        clock,
      )
      const outra = upsertResourceOp(
        boot.db,
        caller,
        { kind: 'room', name: 'Outra', capacity: 2 },
        clock,
      )
      const ana = upsertResourceOp(
        boot.db,
        caller,
        { kind: 'professional', name: 'Ana', homeRoomId: sala.id },
        clock,
      )
      const bia = upsertResourceOp(
        boot.db,
        caller,
        { kind: 'professional', name: 'Bia', homeRoomId: sala.id },
        clock,
      )
      setWeeklyWindowsOp(boot.db, caller, { resourceId: ana.id, windows: [DAY] }, clock)
      setWeeklyWindowsOp(boot.db, caller, { resourceId: bia.id, windows: [DAY] }, clock)
      const svc = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Corte',
          durationMinutes: 60,
          bufferMinutes: 0,
          professionalIds: [ana.id, bia.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      confirmAppointmentOp(
        boot.db,
        caller,
        {
          clientRequestId: 's6-1',
          serviceId: svc.id,
          professionalId: ana.id,
          startsAt: at(9),
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      confirmAppointmentOp(
        boot.db,
        caller,
        {
          clientRequestId: 's6-2',
          serviceId: svc.id,
          professionalId: bia.id,
          startsAt: at(9),
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      try {
        confirmAppointmentOp(
          boot.db,
          caller,
          {
            clientRequestId: 's6-full',
            serviceId: svc.id,
            professionalId: ana.id,
            roomResourceId: sala.id,
            startsAt: at(9),
            actorClerkUserId: 'user_synth_owner_a',
          },
          clock,
        )
        expect.unreachable('sala cheia')
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError)
        expect((err as ConflictError).message).toBe(REFUSAL_ROOM_FULL)
        expect((err as ConflictError).code).toBe('room_at_capacity')
      }

      // Ana livre na outra sala? Não — já está no salão; destino ainda tem vaga se
      // cancelássemos a lotação, mas com Ana ocupada a frase é da outra sala.
      try {
        confirmAppointmentOp(
          boot.db,
          caller,
          {
            clientRequestId: 's6-other',
            serviceId: svc.id,
            professionalId: ana.id,
            roomResourceId: outra.id,
            startsAt: at(9),
            actorClerkUserId: 'user_synth_owner_a',
          },
          clock,
        )
        expect.unreachable('outra sala')
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError)
        expect((err as ConflictError).message).toBe(REFUSAL_PRO_OTHER_ROOM)
        expect((err as ConflictError).code).toBe('professional_other_room')
      }
    } finally {
      boot.close()
    }
  })

  it('sexo oposto devolve frase do público sem quantidade', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const boot = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const sala = upsertResourceOp(
        boot.db,
        caller,
        {
          kind: 'room',
          name: 'Sandra',
          capacity: 4,
          attendanceMode: 'uma_para_todas',
          sameSexInSlot: true,
        },
        clock,
      )
      const sandra = upsertResourceOp(
        boot.db,
        caller,
        { kind: 'professional', name: 'Sandra', homeRoomId: sala.id },
        clock,
      )
      setWeeklyWindowsOp(boot.db, caller, { resourceId: sandra.id, windows: [DAY] }, clock)
      const fem = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Bronze F',
          durationMinutes: 60,
          bufferMinutes: 0,
          audiencia: 'feminino',
          professionalIds: [sandra.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      const masc = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Bronze M',
          durationMinutes: 60,
          bufferMinutes: 0,
          audiencia: 'masculino',
          professionalIds: [sandra.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      confirmAppointmentOp(
        boot.db,
        caller,
        {
          clientRequestId: 's6-f',
          serviceId: fem.id,
          professionalId: sandra.id,
          startsAt: at(9),
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      const check = checkSlotAvailabilityOp(
        boot.db,
        caller,
        { serviceId: masc.id, professionalId: sandra.id, startsAt: at(9) },
        clock,
      )
      expect(check.reasons).toContain('room_sex_mismatch')
      expect(check.blockSex).toBe('feminino')
      try {
        confirmAppointmentOp(
          boot.db,
          caller,
          {
            clientRequestId: 's6-m',
            serviceId: masc.id,
            professionalId: sandra.id,
            startsAt: at(9),
            actorClerkUserId: 'user_synth_owner_a',
          },
          clock,
        )
        expect.unreachable('sexo')
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError)
        expect((err as ConflictError).message).toBe(REFUSAL_SEX_FEMININO)
        expect((err as ConflictError).message).not.toMatch(/\d/)
        expect((err as ConflictError).message).not.toMatch(/Permitir os dois/i)
      }
    } finally {
      boot.close()
    }
  })
})
