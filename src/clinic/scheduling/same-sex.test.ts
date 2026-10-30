/**
 * DEC-075 / S5 — «Mesmo sexo neste horário» e «Permitir os dois».
 * Caso Sandra do épico.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ConflictError, ValidationError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import {
  allowBothSexesInBlockOp,
  checkSlotAvailabilityOp,
  confirmAppointmentOp,
  queryAvailabilityOp,
  zonedCivilToUtc,
} from './index'

const TZ = 'America/Sao_Paulo'
const MONDAY = '2024-01-08'
const at = (h: number, m = 0) => zonedCivilToUtc(TZ, 2024, 1, 8, h, m)
const DAY = { dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }

function seedSandra() {
  const clock = createControllableClock(Date.UTC(2024, 0, 1))
  const boot = bootClinicDb({ clock })
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const sala = upsertResourceOp(
    boot.db,
    caller,
    {
      kind: 'room',
      name: 'Sala da Sandra',
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
  const feminino = upsertServiceOp(
    boot.db,
    caller,
    {
      name: 'Bronzeamento feminino',
      durationMinutes: 60,
      bufferMinutes: 0,
      audiencia: 'feminino',
      professionalIds: [sandra.id],
      roomRequirement: { mode: 'rooms', resourceIds: [sala.id] },
    },
    clock,
  )
  const masculino = upsertServiceOp(
    boot.db,
    caller,
    {
      name: 'Bronzeamento masculino',
      durationMinutes: 60,
      bufferMinutes: 0,
      audiencia: 'masculino',
      professionalIds: [sandra.id],
      roomRequirement: { mode: 'rooms', resourceIds: [sala.id] },
    },
    clock,
  )
  const qualquer = upsertServiceOp(
    boot.db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 60,
      bufferMinutes: 0,
      audiencia: 'qualquer',
      professionalIds: [sandra.id],
      roomRequirement: { mode: 'rooms', resourceIds: [sala.id] },
    },
    clock,
  )
  let n = 0
  const book = (
    serviceId: string,
    startsAt: number,
    actor = 'user_synth_owner_a',
  ) =>
    confirmAppointmentOp(
      boot.db,
      caller,
      {
        clientRequestId: `sx-${(n += 1)}`,
        serviceId,
        professionalId: sandra.id,
        startsAt,
        actorClerkUserId: actor,
      },
      clock,
    )
  return {
    ...boot,
    clock,
    caller,
    sala,
    sandra,
    feminino,
    masculino,
    qualquer,
    book,
  }
}

describe('S5 — Mesmo sexo e Permitir os dois', () => {
  it('primeira marcação feminina fixa o bloco; masculino sobreposto é recusado', () => {
    const s = seedSandra()
    try {
      expect(s.sala.sameSexInSlot).toBe(true)
      s.book(s.feminino.id, at(9))
      expect(() => s.book(s.masculino.id, at(9))).toThrow(ConflictError)
      const check = checkSlotAvailabilityOp(
        s.db,
        s.caller,
        {
          serviceId: s.masculino.id,
          professionalId: s.sandra.id,
          startsAt: at(9),
        },
        s.clock,
      )
      expect(check.available).toBe(false)
      expect(check.reasons).toContain('room_sex_mismatch')
      const avail = queryAvailabilityOp(
        s.db,
        s.caller,
        { serviceId: s.masculino.id, date: MONDAY, professionalId: s.sandra.id },
        s.clock,
      )
      expect(avail.slots.some((x) => x.startsAt === at(9))).toBe(false)
    } finally {
      s.close()
    }
  })

  it('audiência qualquer entra no bloco e não muda o sexo', () => {
    const s = seedSandra()
    try {
      s.book(s.feminino.id, at(9))
      expect(s.book(s.qualquer.id, at(9)).value.status).toBe('confirmed')
      expect(() => s.book(s.masculino.id, at(9))).toThrow(ConflictError)
    } finally {
      s.close()
    }
  })

  it('sala cheia recusa mesmo com o sexo certo', () => {
    const s = seedSandra()
    try {
      s.book(s.feminino.id, at(9))
      s.book(s.feminino.id, at(9))
      s.book(s.feminino.id, at(9))
      s.book(s.feminino.id, at(9))
      expect(() => s.book(s.feminino.id, at(9))).toThrow(ConflictError)
    } finally {
      s.close()
    }
  })

  it('responsável permite os dois; IA não grava (atendente bloqueada no HTTP)', () => {
    const s = seedSandra()
    try {
      s.book(s.feminino.id, at(9))
      expect(() =>
        allowBothSexesInBlockOp(
          s.db,
          workerCaller('clinic-demo-a', 'ai_suggest'),
          { roomResourceId: s.sala.id, startsAt: at(9), endsAt: at(10) },
          s.clock,
        ),
      ).toThrow(ValidationError)

      const allowed = allowBothSexesInBlockOp(
        s.db,
        s.caller,
        { roomResourceId: s.sala.id, startsAt: at(9), endsAt: at(10) },
        s.clock,
      )
      expect(allowed.roomResourceId).toBe(s.sala.id)
      expect(s.book(s.masculino.id, at(9)).value.status).toBe('confirmed')

      const audit = s.db.get<{ action: string; actor: string }>(
        `SELECT action, actor FROM operational_audit
         WHERE action = 'room.allow_both_sexes' ORDER BY occurred_at DESC LIMIT 1`,
      )
      expect(audit?.action).toBe('room.allow_both_sexes')
      expect(audit?.actor).toBe('user_synth_owner_a')
    } finally {
      s.close()
    }
  })

  it('depois de a sala ficar livre, o outro sexo abre bloco novo sem herdar a excepção', () => {
    const s = seedSandra()
    try {
      const first = s.book(s.feminino.id, at(9))
      allowBothSexesInBlockOp(
        s.db,
        s.caller,
        { roomResourceId: s.sala.id, startsAt: at(9), endsAt: at(10) },
        s.clock,
      )
      // Cancela a única marcação → sala livre.
      s.db.run(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`, first.value.id)
      // Masculino às 11h: bloco novo, sem herdar «Permitir os dois» do bloco das 9h.
      expect(s.book(s.masculino.id, at(11)).value.status).toBe('confirmed')
      expect(() => s.book(s.feminino.id, at(11))).toThrow(ConflictError)
    } finally {
      s.close()
    }
  })

  it('capacidade 1 não activa mesmo sexo nem permite os dois', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const boot = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const room = upsertResourceOp(
        boot.db,
        caller,
        {
          kind: 'room',
          name: 'Única',
          capacity: 1,
          sameSexInSlot: true,
        },
        clock,
      )
      expect(room.sameSexInSlot).toBe(false)
      expect(() =>
        allowBothSexesInBlockOp(
          boot.db,
          caller,
          { roomResourceId: room.id, startsAt: at(9), endsAt: at(10) },
          clock,
        ),
      ).toThrow(ValidationError)
    } finally {
      boot.close()
    }
  })
})
