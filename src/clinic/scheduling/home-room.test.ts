/**
 * DEC-075 / S3 — sala da profissional, salão partilhado e contagem por pessoa.
 * Critérios de aceite do épico (Gi; Ana e Bia).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ConflictError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  insertSyntheticAppointment,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import {
  checkSlotAvailabilityOp,
  confirmAppointmentOp,
  queryAvailabilityOp,
  zonedCivilToUtc,
} from './index'
import { peakConcurrentPeople } from './occupancy'

const TZ = 'America/Sao_Paulo'
const MONDAY = '2024-01-08'
const at = (h: number, m = 0) => zonedCivilToUtc(TZ, 2024, 1, 8, h, m)
const DAY = { dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }

describe('S3 — Gi (capacidade 1)', () => {
  function seedGi() {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const boot = bootClinicDb({ clock })
    const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
    const depilacao = upsertResourceOp(
      boot.db,
      caller,
      { kind: 'room', name: 'Depilação', capacity: 1 },
      clock,
    )
    const massagem = upsertResourceOp(
      boot.db,
      caller,
      { kind: 'room', name: 'Massagem', capacity: 1 },
      clock,
    )
    const gi = upsertResourceOp(
      boot.db,
      caller,
      { kind: 'professional', name: 'Gi', homeRoomId: depilacao.id },
      clock,
    )
    const colega = upsertResourceOp(
      boot.db,
      caller,
      { kind: 'professional', name: 'Colega', homeRoomId: massagem.id },
      clock,
    )
    for (const p of [gi, colega]) {
      setWeeklyWindowsOp(boot.db, caller, { resourceId: p.id, windows: [DAY] }, clock)
    }
    const svcDep = upsertServiceOp(
      boot.db,
      caller,
      {
        name: 'Depilação',
        durationMinutes: 60,
        bufferMinutes: 0,
        professionalIds: [gi.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    const svcMas = upsertServiceOp(
      boot.db,
      caller,
      {
        name: 'Massagem',
        durationMinutes: 60,
        bufferMinutes: 0,
        professionalIds: [gi.id, colega.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    return { ...boot, clock, caller, gi, colega, depilacao, massagem, svcDep, svcMas }
  }

  it('Massagem com a Gi usa a sala da Gi; com a colega, a sala de Massagem', () => {
    const s = seedGi()
    try {
      const withGi = queryAvailabilityOp(
        s.db,
        s.caller,
        { serviceId: s.svcMas.id, date: MONDAY, professionalId: s.gi.id },
        s.clock,
      )
      expect(withGi.slots[0]!.roomResourceId).toBe(s.depilacao.id)
      const withColega = queryAvailabilityOp(
        s.db,
        s.caller,
        { serviceId: s.svcMas.id, date: MONDAY, professionalId: s.colega.id },
        s.clock,
      )
      expect(withColega.slots[0]!.roomResourceId).toBe(s.massagem.id)
    } finally {
      s.close()
    }
  })

  it('Gi em depilação às 9h não massaja às 9h; a colega massaja na sala dela', () => {
    const s = seedGi()
    try {
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'gi-dep-9',
          serviceId: s.svcDep.id,
          professionalId: s.gi.id,
          startsAt: at(9),
          actorClerkUserId: 'user_synth_owner_a',
        },
        s.clock,
      )
      const giMas = checkSlotAvailabilityOp(
        s.db,
        s.caller,
        { serviceId: s.svcMas.id, professionalId: s.gi.id, startsAt: at(9) },
        s.clock,
      )
      expect(giMas.available).toBe(false)
      const colega = checkSlotAvailabilityOp(
        s.db,
        s.caller,
        { serviceId: s.svcMas.id, professionalId: s.colega.id, startsAt: at(9) },
        s.clock,
      )
      expect(colega.available).toBe(true)
      expect(colega.slot?.roomResourceId).toBe(s.massagem.id)
    } finally {
      s.close()
    }
  })

  it('troca pontual da sala; a marcação seguinte volta à sala Depilação', () => {
    const s = seedGi()
    try {
      const swapped = confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'gi-swap',
          serviceId: s.svcMas.id,
          professionalId: s.gi.id,
          roomResourceId: s.massagem.id,
          startsAt: at(9),
          actorClerkUserId: 'user_synth_owner_a',
        },
        s.clock,
      )
      expect(swapped.value.roomResourceId).toBe(s.massagem.id)
      const next = queryAvailabilityOp(
        s.db,
        s.caller,
        { serviceId: s.svcMas.id, date: MONDAY, professionalId: s.gi.id },
        s.clock,
      )
      const ten = next.slots.find((x) => x.startsAt === at(10))
      expect(ten!.roomResourceId).toBe(s.depilacao.id)
    } finally {
      s.close()
    }
  })

  it('capacidade 1 não expõe modo nem lugares livres', () => {
    const s = seedGi()
    try {
      expect(s.depilacao.capacity).toBe(1)
      expect(s.depilacao.attendanceMode).toBe('cada_profissional')
      const avail = queryAvailabilityOp(
        s.db,
        s.caller,
        { serviceId: s.svcDep.id, date: MONDAY },
        s.clock,
      )
      expect(avail.slots[0]!.roomCapacity ?? null).toBeNull()
      expect(avail.slots[0]!.roomSeatsFree ?? null).toBeNull()
    } finally {
      s.close()
    }
  })
})

describe('S3 — Ana e Bia (salão partilhado, cada profissional)', () => {
  function seedSalon() {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const boot = bootClinicDb({ clock })
    const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
    const salao = upsertResourceOp(
      boot.db,
      caller,
      { kind: 'room', name: 'Salão', capacity: 2, attendanceMode: 'cada_profissional' },
      clock,
    )
    const ana = upsertResourceOp(
      boot.db,
      caller,
      { kind: 'professional', name: 'Ana', homeRoomId: salao.id },
      clock,
    )
    const bia = upsertResourceOp(
      boot.db,
      caller,
      { kind: 'professional', name: 'Bia', homeRoomId: salao.id },
      clock,
    )
    const cris = upsertResourceOp(
      boot.db,
      caller,
      { kind: 'professional', name: 'Cris', homeRoomId: salao.id },
      clock,
    )
    for (const p of [ana, bia, cris]) {
      setWeeklyWindowsOp(boot.db, caller, { resourceId: p.id, windows: [DAY] }, clock)
    }
    const svc = upsertServiceOp(
      boot.db,
      caller,
      {
        name: 'Corte',
        durationMinutes: 60,
        bufferMinutes: 0,
        professionalIds: [ana.id, bia.id, cris.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    let n = 0
    const book = (proId: string, startsAt: number) =>
      confirmAppointmentOp(
        boot.db,
        caller,
        {
          clientRequestId: `salon-${(n += 1)}`,
          serviceId: svc.id,
          professionalId: proId,
          startsAt,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
    return { ...boot, clock, caller, salao, ana, bia, cris, svc, book }
  }

  it('às 9h cada uma tem uma cliente; a terceira pessoa não entra', () => {
    const s = seedSalon()
    try {
      s.book(s.ana.id, at(9))
      s.book(s.bia.id, at(9))
      expect(() => s.book(s.cris.id, at(9))).toThrow(ConflictError)
      const avail = queryAvailabilityOp(
        s.db,
        s.caller,
        { serviceId: s.svc.id, date: MONDAY },
        s.clock,
      )
      expect(avail.slots.some((x) => x.startsAt === at(9))).toBe(false)
    } finally {
      s.close()
    }
  })

  it('a mesma cliente com dois serviços da Ana no mesmo bloco conta uma pessoa', () => {
    const s = seedSalon()
    try {
      const contactId = 'contato-ana-cliente'
      // Dois compromissos da mesma pessoa com a Ana no mesmo bloco (via inserção sintética
      // para forçar contact_id; a confirmação produtiva também grava contactId quando há).
      insertSyntheticAppointment(
        s.db,
        'clinic-demo-a',
        {
          serviceId: s.svc.id,
          professionalId: s.ana.id,
          roomResourceId: s.salao.id,
          startsAt: at(9),
          endsAt: at(9, 30),
          contactId,
          contactLabel: 'Cliente da Ana',
        },
        s.clock,
      )
      insertSyntheticAppointment(
        s.db,
        'clinic-demo-a',
        {
          serviceId: s.svc.id,
          professionalId: s.ana.id,
          roomResourceId: s.salao.id,
          startsAt: at(9, 15),
          endsAt: at(9, 45),
          contactId,
          contactLabel: 'Cliente da Ana',
        },
        s.clock,
      )
      // Pico de pessoas = 1 (mesmo contacto); Bia ainda cabe na capacidade 2.
      // Nota: Ana está ocupada pela profissional (capacidade 1), mas a sala tem 1 pessoa.
      const range = { startsAt: at(9), endsAt: at(10) }
      expect(
        peakConcurrentPeople(range, [
          { startsAt: at(9), endsAt: at(9, 30), personKey: contactId },
          { startsAt: at(9, 15), endsAt: at(9, 45), personKey: contactId },
        ]),
      ).toBe(1)
      const biaOk = checkSlotAvailabilityOp(
        s.db,
        s.caller,
        { serviceId: s.svc.id, professionalId: s.bia.id, startsAt: at(9) },
        s.clock,
      )
      expect(biaOk.available).toBe(true)
    } finally {
      s.close()
    }
  })
})

describe('peakConcurrentPeople', () => {
  it('dois intervalos da mesma pessoa contam 1; pessoas distintas contam 2', () => {
    const iv = (a: number, b: number, personKey: string) => ({
      startsAt: a * 60_000,
      endsAt: b * 60_000,
      personKey,
    })
    const range = { startsAt: 0, endsAt: 60 * 60_000 }
    expect(peakConcurrentPeople(range, [iv(0, 60, 'a'), iv(15, 45, 'a')])).toBe(1)
    expect(peakConcurrentPeople(range, [iv(0, 60, 'a'), iv(15, 45, 'b')])).toBe(2)
  })
})
