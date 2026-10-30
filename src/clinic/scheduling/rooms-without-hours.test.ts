/**
 * Salas sem expediente (DEC-075) e lista de salas do serviço (DEC-082).
 * Decisão 28/10/2026: salas não têm expediente.
 * DEC-082: a marcação ocupa uma sala livre da lista do serviço.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  createBlockOp,
  getReadinessOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { buildClinicAiContext } from '../ai/schedule-context'
import { CLINIC_MIGRATIONS } from '../migrations'
import { fromNodeSqlite } from '../store'
import { openClinicMemoryDb } from '../test-db'
import {
  checkSlotAvailabilityOp,
  confirmAppointmentOp,
  queryAvailabilityOp,
  zonedCivilToUtc,
} from './index'

const TZ = 'America/Sao_Paulo'
const MONDAY = '2024-01-08'
const at = (h: number, m = 0) => zonedCivilToUtc(TZ, 2024, 1, 8, h, m)
const DAY = { dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }

function seed(sharedHome = false) {
  const clock = createControllableClock(Date.UTC(2024, 0, 1))
  const boot = bootClinicDb({ clock })
  const db = boot.db
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  // Salas SEM nenhuma janela semanal.
  const roomB = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala B' }, clock)
  const roomA = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala A' }, clock)
  const ana = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Ana', homeRoomId: roomA.id },
    clock,
  )
  const bia = upsertResourceOp(
    db,
    caller,
    {
      kind: 'professional',
      name: 'Bia',
      homeRoomId: sharedHome ? roomA.id : roomB.id,
    },
    clock,
  )
  const pros = [ana, bia]
  for (const p of pros) {
    setWeeklyWindowsOp(db, caller, { resourceId: p.id, windows: [DAY] }, clock)
  }
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Limpeza',
      durationMinutes: 60,
      bufferMinutes: 0,
      professionalIds: pros.map((p) => p.id),
      roomRequirement: {
        mode: 'rooms',
        resourceIds: sharedHome ? [roomA.id] : [roomA.id, roomB.id],
      },
    },
    clock,
  )
  let n = 0
  const book = (proIdx: number, startsAt: number, roomId?: string) =>
    confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId: `req-${(n += 1)}`,
        serviceId: svc.id,
        professionalId: pros[proIdx]!.id,
        roomResourceId: roomId,
        startsAt,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
    )
  const check = (proIdx: number, startsAt: number, roomId?: string) =>
    checkSlotAvailabilityOp(
      db,
      caller,
      {
        serviceId: svc.id,
        professionalId: pros[proIdx]!.id,
        roomResourceId: roomId,
        startsAt,
      },
      clock,
    )
  return { ...boot, clock, caller, pros, roomA, roomB, svc, book, check }
}

describe('sala sem expediente', () => {
  it('sala sem janela fica livre (consulta e verificação)', () => {
    const s = seed()
    try {
      const avail = queryAvailabilityOp(s.db, s.caller, { serviceId: s.svc.id, date: MONDAY }, s.clock)
      expect(avail.slots.some((x) => x.startsAt === at(9))).toBe(true)
      expect(s.check(0, at(9)).available).toBe(true)
      const booked = s.book(0, at(9))
      expect(booked.value.status).toBe('confirmed')
      expect(booked.value.roomResourceId).toBe(s.roomA.id)
    } finally {
      s.close()
    }
  })

  it('sala com marcação fica ocupada (capacidade 1)', () => {
    const s = seed(true)
    try {
      s.book(0, at(9))
      const r = s.check(1, at(9))
      expect(r.available).toBe(false)
      expect(r.reasons).toContain('room_at_capacity')
      expect(r.reasons).not.toContain('outside_weekly_hours')
    } finally {
      s.close()
    }
  })

  it('sala com bloqueio fica ocupada', () => {
    const s = seed()
    try {
      createBlockOp(
        s.db,
        s.caller,
        { resourceId: s.roomA.id, startsAt: at(9), endsAt: at(10), reason: 'manutencao' },
        s.clock,
      )
      const r = s.check(0, at(9), s.roomA.id)
      expect(r.reasons).toContain('resource_block')
      const avail = queryAvailabilityOp(s.db, s.caller, { serviceId: s.svc.id, date: MONDAY }, s.clock)
      // Sala A bloqueada às 9: a primeira profissional usa a outra sala da lista.
      const nine = avail.slots.find((x) => x.startsAt === at(9))
      expect(nine?.professionalId).toBe(s.pros[0]!.id)
      expect(nine?.roomResourceId).toBe(s.roomB.id)
      expect(
        avail.slots.some((x) => x.startsAt === at(10) && x.professionalId === s.pros[0]!.id),
      ).toBe(true)
    } finally {
      s.close()
    }
  })
})

describe('sala da profissional (DEC-075 S3)', () => {
  it('cada profissional usa a sua sala; partilha com capacidade 1 bloqueia a segunda', () => {
    const s = seed()
    try {
      let avail = queryAvailabilityOp(s.db, s.caller, { serviceId: s.svc.id, date: MONDAY }, s.clock)
      const nineAna = avail.slots.find(
        (x) => x.startsAt === at(9) && x.professionalId === s.pros[0]!.id,
      )
      expect(nineAna!.roomResourceId).toBe(s.roomA.id)
      s.book(0, at(9))
      avail = queryAvailabilityOp(s.db, s.caller, { serviceId: s.svc.id, date: MONDAY }, s.clock)
      const nineBia = avail.slots.find(
        (x) => x.startsAt === at(9) && x.professionalId === s.pros[1]!.id,
      )
      expect(nineBia!.roomResourceId).toBe(s.roomB.id)
      expect(s.check(1, at(9)).available).toBe(true)
      s.book(1, at(9))
      avail = queryAvailabilityOp(s.db, s.caller, { serviceId: s.svc.id, date: MONDAY }, s.clock)
      expect(avail.slots.some((x) => x.startsAt === at(9))).toBe(false)
    } finally {
      s.close()
    }
  })

  it('troca pontual: roomResourceId no pedido; consulta seguinte volta à sala da profissional', () => {
    const s = seed()
    try {
      const r = s.check(0, at(11), s.roomB.id)
      expect(r.available).toBe(true)
      expect(r.slot?.roomResourceId).toBe(s.roomB.id)
      s.book(0, at(11), s.roomB.id)
      const avail = queryAvailabilityOp(
        s.db,
        s.caller,
        { serviceId: s.svc.id, date: MONDAY, professionalId: s.pros[0]!.id },
        s.clock,
      )
      const twelve = avail.slots.find((x) => x.startsAt === at(12))
      expect(twelve!.roomResourceId).toBe(s.roomA.id)
    } finally {
      s.close()
    }
  })
})

describe('migração 0023', () => {
  it('preserva os requisitos existentes e passa a aceitar any', () => {
    const raw = openClinicMemoryDb()
    const db = fromNodeSqlite(raw)
    try {
      for (const m of CLINIC_MIGRATIONS.filter((x) => x.id < 23)) {
        for (const st of m.statements) db.exec(st)
      }
      expect(() =>
        db.run(
          `INSERT INTO service_room_requirements (tenant_id, service_id, mode) VALUES ('t', 'sx', 'any')`,
        ),
      ).toThrow()
      const rows = [
        ['t', 's1', 'none', null, null],
        ['t', 's2', 'category', 'Laser', null],
        ['t', 's3', 'resource', null, 'r1'],
      ] as const
      for (const r of rows) {
        db.run(
          `INSERT INTO service_room_requirements (tenant_id, service_id, mode, category, resource_id) VALUES (?, ?, ?, ?, ?)`,
          ...r,
        )
      }
      const m23 = CLINIC_MIGRATIONS.find((x) => x.id === 23)!
      expect(m23.name).toBe('0023_room_requirement_any')
      for (const st of m23.statements) db.exec(st)
      const after = db.all<{
        tenant_id: string
        service_id: string
        mode: string
        category: string | null
        resource_id: string | null
      }>(
        `SELECT tenant_id, service_id, mode, category, resource_id FROM service_room_requirements ORDER BY service_id`,
      )
      expect(after.map((a) => [a.tenant_id, a.service_id, a.mode, a.category, a.resource_id])).toEqual(
        rows,
      )
      db.run(
        `INSERT INTO service_room_requirements (tenant_id, service_id, mode) VALUES ('t', 's4', 'any')`,
      )
      expect(() =>
        db.run(
          `INSERT INTO service_room_requirements (tenant_id, service_id, mode) VALUES ('t', 's5', 'bogus')`,
        ),
      ).toThrow()
    } finally {
      raw.close()
    }
  })
})

describe('readiness sem expediente de sala', () => {
  function base() {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const boot = bootClinicDb({ clock })
    const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
    const pro = upsertResourceOp(boot.db, caller, { kind: 'professional', name: 'Gi' }, clock)
    setWeeklyWindowsOp(boot.db, caller, { resourceId: pro.id, windows: [DAY] }, clock)
    return { ...boot, clock, caller, pro }
  }

  it('fica pronta só com profissional quando nenhum serviço pede sala', () => {
    const s = base()
    try {
      upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Avaliação',
          durationMinutes: 30,
          bufferMinutes: 0,
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const r = getReadinessOp(s.db, s.caller, s.clock)
      expect(r.missing).not.toContain('room_or_equipment')
      expect(r.missing).not.toContain('weekly_availability')
      expect(r.agendaConfigured).toBe(true)
    } finally {
      s.close()
    }
  })

  it('sala desativada da lista impede a marcação nova; uma sala nova não entra sozinha', () => {
    const s = base()
    try {
      const laser = upsertResourceOp(
        s.db,
        s.caller,
        { kind: 'room', name: 'Laser' },
        s.clock,
      )
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Laser',
          durationMinutes: 30,
          bufferMinutes: 0,
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'rooms', resourceIds: [laser.id] },
        },
        s.clock,
      )
      upsertResourceOp(s.db, s.caller, { id: laser.id, kind: 'room', name: 'Laser', active: false }, s.clock)
      let r = getReadinessOp(s.db, s.caller, s.clock)
      expect(r.missing).toContain('room_or_equipment')
      expect(r.agendaConfigured).toBe(false)
      upsertResourceOp(s.db, s.caller, { kind: 'room', name: 'Sala nova' }, s.clock)
      expect(getReadinessOp(s.db, s.caller, s.clock).missing).toContain('room_or_equipment')
      upsertResourceOp(s.db, s.caller, { id: laser.id, kind: 'room', name: 'Laser', active: true }, s.clock)
      r = getReadinessOp(s.db, s.caller, s.clock)
      expect(r.missing).not.toContain('room_or_equipment')
      expect(r.agendaConfigured).toBe(true)
      void svc
    } finally {
      s.close()
    }
  })

  it('profissional sem horário continua a faltar', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const boot = bootClinicDb({ clock })
    const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
    try {
      const pro = upsertResourceOp(boot.db, caller, { kind: 'professional', name: 'Gi' }, clock)
      upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Avaliação',
          durationMinutes: 30,
          bufferMinutes: 0,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      expect(getReadinessOp(boot.db, caller, clock).missing).toContain('weekly_availability')
    } finally {
      boot.close()
    }
  })
})

describe('caso real: Gi seg–sex 09–17, sáb 09–12, sala sem horário', () => {
  // Quinta 05/11/2026; agora 11:50 (Brasília).
  const thu = (h: number, m = 0) => zonedCivilToUtc(TZ, 2026, 11, 5, h, m)
  function real() {
    const clock = createControllableClock(thu(11, 50))
    const boot = bootClinicDb({ clock })
    const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
    const room = upsertResourceOp(boot.db, caller, { kind: 'room', name: 'Sala 1' }, clock)
    const gi = upsertResourceOp(
      boot.db,
      caller,
      { kind: 'professional', name: 'Gi', homeRoomId: room.id },
      clock,
    )
    const week = [1, 2, 3, 4, 5].map((d) => ({
      dayOfWeek: d,
      startMinute: 9 * 60,
      endMinute: 17 * 60,
    }))
    setWeeklyWindowsOp(
      boot.db,
      caller,
      {
        resourceId: gi.id,
        windows: [...week, { dayOfWeek: 6, startMinute: 9 * 60, endMinute: 12 * 60 }],
      },
      clock,
    )
    const svc = upsertServiceOp(
      boot.db,
      caller,
      {
        name: 'Limpeza de pele',
        durationMinutes: 60,
        bufferMinutes: 15,
        professionalIds: [gi.id],
        roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
      },
      clock,
    )
    return { ...boot, clock, caller, gi, room, svc }
  }

  it('quinta tem vagas das 12:00 às 15:45', () => {
    const s = real()
    try {
      const avail = queryAvailabilityOp(
        s.db,
        s.caller,
        { serviceId: s.svc.id, date: '2026-11-05' },
        s.clock,
      )
      // Vagas que ainda dá para marcar: início a partir de agora (11:50).
      const starts = avail.slots.map((x) => x.startsAt).filter((t) => t >= s.clock.nowMs())
      expect(starts.length).toBeGreaterThan(0)
      expect(Math.min(...starts)).toBe(thu(12))
      expect(Math.max(...starts)).toBe(thu(15, 45))
      expect(getReadinessOp(s.db, s.caller, s.clock).agendaConfigured).toBe(true)
      expect(avail.slots.every((x) => x.roomResourceId === s.room.id)).toBe(true)
    } finally {
      s.close()
    }
  })

  it('IA usa só o horário dos profissionais', async () => {
    const s = real()
    try {
      // Janela larga na sala não pode alargar o horário de funcionamento.
      setWeeklyWindowsOp(
        s.db,
        s.caller,
        {
          resourceId: s.room.id,
          windows: [
            { dayOfWeek: 7, startMinute: 6 * 60, endMinute: 22 * 60 },
            { dayOfWeek: 4, startMinute: 6 * 60, endMinute: 22 * 60 },
          ],
        },
        s.clock,
      )
      const ctx = await buildClinicAiContext(s.db, 'clinic-demo-a', s.clock, {
        contactId: 'c-none',
        recentTexts: [],
      })
      const joined = ctx.openingHours.join(' | ')
      expect(joined).toMatch(/09:00–17:00/)
      expect(joined).toMatch(/09:00–12:00/)
      expect(joined).not.toMatch(/06:00|22:00/)
      expect(ctx.openingHours.filter((l) => /fechado/.test(l))).toHaveLength(1)
    } finally {
      s.close()
    }
  })
})

describe('equipamento exigido (DEC-059 + DEC-075)', () => {
  it('equipamento continua uma vaga mesmo com sala partilhada', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const boot = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const room = upsertResourceOp(
        boot.db,
        caller,
        { kind: 'room', name: 'Sala 1', capacity: 2 },
        clock,
      )
      const laser = upsertResourceOp(
        boot.db,
        caller,
        { kind: 'equipment', name: 'Laser diodo' },
        clock,
      )
      const gi = upsertResourceOp(
        boot.db,
        caller,
        { kind: 'professional', name: 'Gi', homeRoomId: room.id },
        clock,
      )
      const colega = upsertResourceOp(
        boot.db,
        caller,
        { kind: 'professional', name: 'Colega', homeRoomId: room.id },
        clock,
      )
      for (const p of [gi, colega]) {
        setWeeklyWindowsOp(boot.db, caller, { resourceId: p.id, windows: [DAY] }, clock)
      }
      const svc = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Laser',
          durationMinutes: 30,
          bufferMinutes: 0,
          professionalIds: [gi.id, colega.id],
          roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
          equipmentResourceId: laser.id,
        },
        clock,
      )
      confirmAppointmentOp(
        boot.db,
        caller,
        {
          clientRequestId: 'eq-1',
          serviceId: svc.id,
          professionalId: gi.id,
          startsAt: at(9),
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      const blocked = checkSlotAvailabilityOp(
        boot.db,
        caller,
        { serviceId: svc.id, professionalId: colega.id, startsAt: at(9) },
        clock,
      )
      expect(blocked.available).toBe(false)
      expect(blocked.reasons).toContain('appointment_conflict')
    } finally {
      boot.close()
    }
  })
})
