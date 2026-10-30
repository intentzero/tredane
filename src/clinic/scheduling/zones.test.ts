/**
 * DEC-078 / #293 — zonas no mesmo horário (AC-57–AC-60).
 */
import { describe, expect, it } from 'vitest'
import { analyzeContentRules } from '../../ai/rules'
import { createControllableClock } from '../../db/clock'
import { computeSignalAmountCents } from '../../pix/money'
import { ValidationError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  quoteVisit,
  readZoneSnapshots,
  replaceServiceZonesOp,
  zonesNamedInText,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
  zoneSnapshotsDrifted,
} from '../config'
import { confirmAppointmentOp, queryAgendaViewOp, rescheduleAppointmentOp, zonedCivilToUtc } from './index'

const TZ = 'America/Sao_Paulo'

function seed() {
  const clock = createControllableClock(Date.UTC(2024, 0, 1))
  const { db, close } = bootClinicDb({ clock })
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Dra. Paula Reis', homeRoomId: room.id },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }] },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceCents: 12_000,
      variantKind: 'Zona',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  return { db, close, clock, caller, pro, svc }
}

describe('zonas do serviço (DEC-078)', () => {
  it('a primeira zona copia duração e preço; a visita soma um intervalo', () => {
    const { db, close, clock, caller, pro, svc } = seed()
    try {
      const copied = replaceServiceZonesOp(
        db,
        caller,
        svc.id,
        [{ name: 'Axila', audience: 'ambos' }],
        clock,
      )
      expect(copied).toMatchObject([{ name: 'Axila', durationMinutes: 60, priceCents: 12_000 }])

      const zones = replaceServiceZonesOp(
        db,
        caller,
        svc.id,
        [
          { id: copied[0]!.id, name: 'Axila', durationMinutes: 15, priceCents: 4_000, audience: 'ambos' },
          { name: 'Meia perna', durationMinutes: 30, priceCents: 8_000, audience: 'ambos' },
        ],
        clock,
      )
      const quote = quoteVisit(
        db,
        caller.tenantId,
        svc,
        zones.map((z) => z.id),
      )
      expect(quote.durationMinutes).toBe(45)
      expect(quote.priceCents).toBe(12_000)

      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0)
      const booked = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-zones-1',
          serviceId: svc.id,
          professionalId: pro.id,
          startsAt,
          contactLabel: 'Ana Silva',
          actorClerkUserId: caller.actorId!,
          zoneIds: zones.map((z) => z.id),
        },
        clock,
      )
      expect(booked.value.endsAt - booked.value.startsAt).toBe(45 * 60_000)
      expect(booked.value.occupiesUntil! - booked.value.startsAt).toBe(60 * 60_000)
      expect(booked.value.serviceName).toBe('Depilação · Axila, Meia perna')
      expect(booked.value.zones.map((z) => z.name)).toEqual(['Axila', 'Meia perna'])

      const fixed = computeSignalAmountCents(
        { requiresSignal: true, kind: 'fixed', fixedCents: 5_000, percent: null },
        quote.priceCents,
      )
      expect(fixed).toEqual({ ok: true, amountCents: 5_000 })
      const percent = computeSignalAmountCents(
        { requiresSignal: true, kind: 'percent', fixedCents: null, percent: 10 },
        quote.priceCents,
      )
      expect(percent).toEqual({ ok: true, amountCents: 1_200 })

      replaceServiceZonesOp(
        db,
        caller,
        svc.id,
        zones.map((z) => ({ ...z, durationMinutes: z.durationMinutes + 15, priceCents: 1 })),
        clock,
      )
      const snaps = readZoneSnapshots(db, caller.tenantId, 'appointment', booked.value.id)
      expect(snaps.map((z) => z.durationMinutes)).toEqual([15, 30])
      expect(zoneSnapshotsDrifted(db, caller.tenantId, svc.id, snaps)).toBe(true)

      const moved = rescheduleAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-zones-move',
          appointmentId: booked.value.id,
          reason: 'contato_remarcou',
          professionalId: pro.id,
          startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 11, 0),
          actorClerkUserId: caller.actorId!,
        },
        clock,
      )
      expect(moved.value.endsAt - moved.value.startsAt).toBe(45 * 60_000)
      expect(moved.value.zones.map((z) => z.name)).toEqual(['Axila', 'Meia perna'])

      const day = queryAgendaViewOp(db, caller, { date: '2024-01-08', view: 'day' }, clock)
      expect(day.appointments[0]?.serviceName).toBe('Depilação · Axila, Meia perna')
    } finally {
      close()
    }
  })

  it('aceita duração em minutos que não é múltiplo de 15', () => {
    const { db, close, clock, caller, pro, svc } = seed()
    try {
      const saved = upsertServiceOp(
        db,
        caller,
        {
          id: svc.id,
          name: 'Depilação',
          durationMinutes: 10,
          bufferMinutes: 0,
          priceCents: 12_000,
          variantKind: 'Zona',
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      expect(saved.durationMinutes).toBe(10)
      const zones = replaceServiceZonesOp(
        db,
        caller,
        svc.id,
        [{ name: 'Axila', durationMinutes: 7, priceCents: 5_000, audience: 'ambos' }],
        clock,
      )
      expect(zones[0]?.durationMinutes).toBe(7)
      expect(() =>
        upsertServiceOp(
          db,
          caller,
          {
            id: svc.id,
            name: 'Depilação',
            durationMinutes: 10,
            bufferMinutes: 0,
            priceCents: 12_000,
            variantKind: null,
            professionalIds: [pro.id],
            roomRequirement: { mode: 'none' },
          },
          clock,
        ),
      ).toThrow(/remova as variantes/)
      replaceServiceZonesOp(db, caller, svc.id, [], clock)
      const cleared = upsertServiceOp(
        db,
        caller,
        {
          id: svc.id,
          name: 'Depilação',
          durationMinutes: 10,
          bufferMinutes: 0,
          priceCents: 12_000,
          variantKind: null,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      expect(cleared.variantKind).toBeNull()
    } finally {
      close()
    }
  })

  it('recusa zona repetida, de outro serviço ou sem preço somável no sinal percentual', () => {
    const { db, close, clock, caller, pro, svc } = seed()
    try {
      const other = upsertServiceOp(
        db,
        caller,
        {
          name: 'Limpeza',
          durationMinutes: 30,
          bufferMinutes: 0,
          variantKind: 'Zona',
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      const zones = replaceServiceZonesOp(
        db,
        caller,
        svc.id,
        [
          { name: 'Axila', durationMinutes: 15, priceCents: 4_000, audience: 'ambos' },
          { name: 'Virilha', durationMinutes: 30, priceCents: null, audience: 'ambos' },
        ],
        clock,
      )
      const otherZones = replaceServiceZonesOp(
        db,
        caller,
        other.id,
        [{ name: 'Rosto', durationMinutes: 30, priceCents: 9_000, audience: 'ambos' }],
        clock,
      )
      const fresh = { ...svc, zones }
      expect(() => quoteVisit(db, caller.tenantId, fresh, [zones[0]!.id, zones[0]!.id])).toThrow(ValidationError)
      expect(() => quoteVisit(db, caller.tenantId, fresh, [otherZones[0]!.id])).toThrow(ValidationError)
      expect(() =>
        quoteVisit(db, 'clinic-b', fresh, [zones[0]!.id]),
      ).toThrow(ValidationError)

      const partial = quoteVisit(db, caller.tenantId, fresh, zones.map((z) => z.id))
      expect(partial.priceCents).toBeNull()
      const percent = computeSignalAmountCents(
        { requiresSignal: true, kind: 'percent', fixedCents: null, percent: 10 },
        partial.priceCents,
      )
      expect(percent.ok).toBe(false)
      if (!percent.ok) expect(percent.code).toBe('percent_requires_price')

      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 14, 0)
      expect(() =>
        confirmAppointmentOp(
          db,
          caller,
          {
            clientRequestId: 'req-zones-bad',
            serviceId: svc.id,
            professionalId: pro.id,
            startsAt,
            actorClerkUserId: caller.actorId!,
            zoneIds: [otherZones[0]!.id],
          },
          clock,
        ),
      ).toThrow(ValidationError)
      expect(
        db.get('SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?', caller.tenantId),
      ).toEqual({ n: 0 })
    } finally {
      close()
    }
  })

  it('serviço sem zonas continua na duração do cadastro', () => {
    const { db, close, clock, caller, pro, svc } = seed()
    try {
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 15, 0)
      const booked = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-plain',
          serviceId: svc.id,
          professionalId: pro.id,
          startsAt,
          actorClerkUserId: caller.actorId!,
        },
        clock,
      )
      expect(booked.value.endsAt - booked.value.startsAt).toBe(60 * 60_000)
      expect(booked.value.zones).toEqual([])
      expect(booked.value.serviceName).toBe('Depilação')
    } finally {
      close()
    }
  })

  it('pergunta de preço sem zona não autoriza valor', () => {
    const services = [
      {
        name: 'Depilação',
        durationMinutes: 60,
        priceCents: 12_000,
        clientExplanation: null,
        audiencia: 'qualquer' as const,
        zones: [
          { name: 'Axila', durationMinutes: 15, priceCents: 4_000, audience: 'ambos' as const },
          { name: 'Meia perna', durationMinutes: 30, priceCents: 8_000, audience: 'ambos' as const },
        ],
      },
    ]
    const onlyService = analyzeContentRules(
      [{ direction: 'inbound', body: 'quanto custa a depilação?' }],
      services,
    )
    expect(onlyService.warnings).toContain('no_price')
    const named = analyzeContentRules(
      [{ direction: 'inbound', body: 'quanto custa depilação na axila e meia perna?' }],
      services,
    )
    expect(named.warnings).not.toContain('no_price')
    const mixed = analyzeContentRules(
      [{ direction: 'inbound', body: 'quanto custa depilação na axila e na barba?' }],
      [
        {
          ...services[0]!,
          variantKind: 'Zona',
          zones: [
            { name: 'Axila', durationMinutes: 15, priceCents: 4_000, audience: 'feminino' as const },
            { name: 'Barba', durationMinutes: 15, priceCents: 5_000, audience: 'masculino' as const },
          ],
        },
      ],
    )
    expect(mixed.warnings).toContain('no_price')
  })
})

describe('tipo e género das variantes (DEC-079)', () => {
  it('exige o tipo quando há variantes e recusa a omissão do género', () => {
    const { db, close, clock, caller, svc } = seed()
    try {
      const bare = upsertServiceOp(
        db,
        caller,
        {
          id: svc.id,
          name: 'Depilação',
          durationMinutes: 60,
          bufferMinutes: 15,
          priceCents: 12_000,
          variantKind: null,
          professionalIds: svc.professionalIds,
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      expect(bare.variantKind).toBeNull()
      expect(() =>
        replaceServiceZonesOp(
          db,
          caller,
          svc.id,
          [{ name: 'Axila', durationMinutes: 15, priceCents: 4_000, audience: 'feminino' }],
          clock,
        ),
      ).toThrow(ValidationError)
      expect(
        db.get('SELECT COUNT(*) AS n FROM service_zones WHERE tenant_id = ?', caller.tenantId),
      ).toEqual({ n: 0 })

      upsertServiceOp(
        db,
        caller,
        {
          id: svc.id,
          name: 'Depilação',
          durationMinutes: 60,
          bufferMinutes: 15,
          priceCents: 12_000,
          variantKind: 'Zona',
          professionalIds: svc.professionalIds,
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      expect(() =>
        replaceServiceZonesOp(
          db,
          caller,
          svc.id,
          [{ name: 'Axila', durationMinutes: 15, priceCents: 4_000, audience: undefined as never }],
          clock,
        ),
      ).toThrow(ValidationError)
    } finally {
      close()
    }
  })

  it('recusa masculino com feminino e não grava a visita; ambos combina', () => {
    const { db, close, clock, caller, pro, svc } = seed()
    try {
      const zones = replaceServiceZonesOp(
        db,
        caller,
        svc.id,
        [
          { name: 'Axila', durationMinutes: 15, priceCents: 4_000, audience: 'feminino' },
          { name: 'Barba', durationMinutes: 15, priceCents: 5_000, audience: 'masculino' },
          { name: 'Braços', durationMinutes: 30, priceCents: 8_000, audience: 'ambos' },
        ],
        clock,
      )
      const axila = zones.find((z) => z.name === 'Axila')!
      const barba = zones.find((z) => z.name === 'Barba')!
      const bracos = zones.find((z) => z.name === 'Braços')!
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0)
      expect(() =>
        confirmAppointmentOp(
          db,
          caller,
          {
            clientRequestId: 'req-mix',
            serviceId: svc.id,
            professionalId: pro.id,
            startsAt,
            actorClerkUserId: caller.actorId!,
            zoneIds: [axila.id, barba.id],
          },
          clock,
        ),
      ).toThrow(ValidationError)
      expect(
        db.get('SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?', caller.tenantId),
      ).toEqual({ n: 0 })

      const booked = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-both',
          serviceId: svc.id,
          professionalId: pro.id,
          startsAt,
          actorClerkUserId: caller.actorId!,
          zoneIds: [axila.id, bracos.id],
        },
        clock,
      )
      expect(booked.value.endsAt - booked.value.startsAt).toBe(45 * 60_000)
      expect(booked.value.zones.map((z) => z.audience).sort()).toEqual(['ambos', 'feminino'])
    } finally {
      close()
    }
  })

  it('variante gravada sem género explícito fica ambos e marca', () => {
    const { db, close, clock, caller, pro, svc } = seed()
    try {
      const now = clock.nowMs()
      db.run(
        `INSERT INTO service_zones (
          id, tenant_id, service_id, name, duration_minutes, price_cents, active, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'zone_legacy',
        caller.tenantId,
        svc.id,
        'Axila',
        15,
        4_000,
        1,
        0,
        now,
        now,
      )
      const quote = quoteVisit(db, caller.tenantId, svc, ['zone_legacy'])
      expect(quote.zones[0]?.audience).toBe('ambos')
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0)
      const booked = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-legacy',
          serviceId: svc.id,
          professionalId: pro.id,
          startsAt,
          actorClerkUserId: caller.actorId!,
          zoneIds: ['zone_legacy'],
        },
        clock,
      )
      expect(booked.value.zones[0]?.audience).toBe('ambos')
      expect(booked.value.endsAt - booked.value.startsAt).toBe(15 * 60_000)
    } finally {
      close()
    }
  })
})

describe('zonesNamedInText', () => {
  const zone = (id: string, name: string) => ({
    id,
    tenantId: 't',
    serviceId: 's',
    name,
    durationMinutes: 30,
    priceCents: 100,
    audience: 'ambos' as const,
    active: true,
    sortOrder: 0,
  })

  it('o nome mais longo ganha e um nome curto não casa dentro dele', () => {
    const zones = [zone('a', 'Perna'), zone('b', 'Meia perna')]
    expect(zonesNamedInText('quero meia perna', zones).map((z) => z.name)).toEqual(['Meia perna'])
    expect(zonesNamedInText('só a perna', zones).map((z) => z.name)).toEqual(['Perna'])
  })
})
