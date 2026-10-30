/**
 * Capacidade simultânea por sala (D-20261027-180200-CUR; card t1892s7600).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ConflictError, ValidationError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { confirmAppointmentOp, queryAvailabilityOp, zonedCivilToUtc } from './index'
import { peakConcurrent } from './occupancy'

const TZ = 'America/Sao_Paulo'
const MONDAY = '2024-01-08'
const at = (h: number, m = 0) => zonedCivilToUtc(TZ, 2024, 1, 8, h, m)

function seed(capacity?: number, notice?: string) {
  const clock = createControllableClock(Date.UTC(2024, 0, 1))
  const boot = bootClinicDb({ clock })
  const db = boot.db
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const room = upsertResourceOp(
    db,
    caller,
    {
      kind: 'room',
      name: 'Espaço de bronzeamento',
      category: 'Bronze',
      ...(capacity ? { capacity } : {}),
      ...(notice ? { sharedSpaceNotice: notice } : {}),
    },
    clock,
  )
  const pros = ['Ana', 'Bia', 'Cris'].map((n) =>
    upsertResourceOp(db, caller, { kind: 'professional', name: n, homeRoomId: room.id }, clock),
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Bronzeamento',
      durationMinutes: 60,
      bufferMinutes: 0,
      professionalIds: pros.map((p) => p.id),
      roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
    },
    clock,
  )
  for (const r of [...pros, room]) {
    setWeeklyWindowsOp(
      db,
      caller,
      { resourceId: r.id, windows: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }] },
      clock,
    )
  }
  let n = 0
  const book = (proIdx: number, startsAt: number) =>
    confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId: `req-${(n += 1)}`,
        serviceId: svc.id,
        professionalId: pros[proIdx]!.id,
        roomResourceId: room.id,
        startsAt,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
    )
  return { ...boot, clock, caller, pros, room, svc, book }
}

describe('capacidade por sala', () => {
  it('sala de 1 lugar não expõe capacidade nem lugares', () => {
    const s = seed()
    try {
      const avail = queryAvailabilityOp(s.db, s.caller, { serviceId: s.svc.id, date: MONDAY }, s.clock)
      const first = avail.slots[0]!
      expect(first.roomCapacity ?? null).toBeNull()
      expect(first.roomSeatsFree ?? null).toBeNull()
    } finally {
      s.close()
    }
  })

  it('padrão 1: comportamento igual ao de antes (um já basta)', () => {
    const s = seed()
    try {
      expect(s.room.capacity).toBe(1)
      s.book(0, at(9))
      expect(() => s.book(1, at(9))).toThrow(ConflictError)
    } finally {
      s.close()
    }
  })

  it('capacidade 2: aceita duas pessoas e bloqueia a terceira no pico', () => {
    const s = seed(2)
    try {
      s.book(0, at(9))
      s.book(1, at(9, 30))
      expect(() => s.book(2, at(9))).toThrow(ConflictError)
      expect(() => s.book(2, at(9, 15))).toThrow(ConflictError)
      // Pico por bloco de 15 min: às 10:00 A já saiu, só B está → C cabe.
      expect(s.book(2, at(10)).value.status).toBe('confirmed')
    } finally {
      s.close()
    }
  })

  it('a profissional continua a atender uma pessoa de cada vez', () => {
    const s = seed(5)
    try {
      s.book(0, at(9))
      expect(() => s.book(0, at(9, 30))).toThrow(ConflictError)
    } finally {
      s.close()
    }
  })

  it('Agendar: horário lotado some da lista; frase fixa da sala vai no slot', () => {
    const s = seed(2, 'O espaço é compartilhado.')
    try {
      s.book(0, at(9))
      let avail = queryAvailabilityOp(s.db, s.caller, { serviceId: s.svc.id, date: MONDAY }, s.clock)
      const nine = avail.slots.find((x) => x.startsAt === at(9))
      expect(nine).toBeTruthy()
      expect(nine!.roomSharedNotice).toBe('O espaço é compartilhado.')
      // Lugares livres para exibição: 1 de 2 ocupado às 09:00, nenhum às 11:00.
      expect(nine!.roomCapacity).toBe(2)
      expect(nine!.roomSeatsFree).toBe(1)
      expect(avail.slots.find((x) => x.startsAt === at(11))!.roomSeatsFree).toBe(2)
      s.book(1, at(9))
      avail = queryAvailabilityOp(s.db, s.caller, { serviceId: s.svc.id, date: MONDAY }, s.clock)
      expect(avail.slots.some((x) => x.startsAt === at(9))).toBe(false)
      expect(avail.slots.some((x) => x.startsAt === at(10))).toBe(true)
    } finally {
      s.close()
    }
  })

  it('valida limites: 1–50, só sala', () => {
    const s = seed()
    try {
      expect(() =>
        upsertResourceOp(s.db, s.caller, { kind: 'room', name: 'X', capacity: 51 }, s.clock),
      ).toThrow(ValidationError)
      expect(() =>
        upsertResourceOp(s.db, s.caller, { kind: 'room', name: 'X', capacity: 0 }, s.clock),
      ).toThrow(ValidationError)
      expect(() =>
        upsertResourceOp(s.db, s.caller, { kind: 'equipment', name: 'Y', capacity: 2 }, s.clock),
      ).toThrow(ValidationError)
      const ok = upsertResourceOp(s.db, s.caller, { kind: 'room', name: 'Z', capacity: 50 }, s.clock)
      expect(ok.capacity).toBe(50)
      // Editar sem enviar capacidade mantém o valor.
      const kept = upsertResourceOp(s.db, s.caller, { id: ok.id, kind: 'room', name: 'Z2' }, s.clock)
      expect(kept.capacity).toBe(50)
    } finally {
      s.close()
    }
  })

  it('reduzir abaixo do marcado: permitido, avisa com a lista, não apaga nada', () => {
    const s = seed(3)
    try {
      s.book(0, at(9))
      s.book(1, at(9))
      s.book(2, at(9, 30))
      const row = upsertResourceOp(
        s.db,
        s.caller,
        { id: s.room.id, kind: 'room', name: s.room.name, category: 'Bronze', capacity: 1 },
        s.clock,
      )
      expect(row.capacity).toBe(1)
      expect(row.overCapacity).toEqual([
        { startsAt: at(9), endsAt: at(9, 30), count: 2 },
        { startsAt: at(9, 30), endsAt: at(10), count: 3 },
      ])
      const n = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE status = 'confirmed'`,
      )
      expect(n?.n).toBe(3)
    } finally {
      s.close()
    }
  })

  it('peakConcurrent conta por bloco de 15 min', () => {
    const iv = (a: number, b: number) => ({ startsAt: a * 60_000, endsAt: b * 60_000 })
    expect(peakConcurrent(iv(0, 60), [iv(0, 60), iv(30, 90)])).toBe(2)
    expect(peakConcurrent(iv(60, 120), [iv(0, 60), iv(30, 90)])).toBe(1)
  })
})
