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
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Dra. Paula Reis' }, clock)
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
      const copied = replaceServiceZonesOp(db, caller, svc.id, [{ name: 'Axila' }], clock)
      expect(copied).toMatchObject([{ name: 'Axila', durationMinutes: 60, priceCents: 12_000 }])

      const zones = replaceServiceZonesOp(
        db,
        caller,
        svc.id,
        [
          { id: copied[0]!.id, name: 'Axila', durationMinutes: 15, priceCents: 4_000 },
          { name: 'Meia perna', durationMinutes: 30, priceCents: 8_000 },
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
          { name: 'Axila', durationMinutes: 15, priceCents: 4_000 },
          { name: 'Virilha', durationMinutes: 30, priceCents: null },
        ],
        clock,
      )
      const otherZones = replaceServiceZonesOp(
        db,
        caller,
        other.id,
        [{ name: 'Rosto', durationMinutes: 30, priceCents: 9_000 }],
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
          { name: 'Axila', durationMinutes: 15, priceCents: 4_000 },
          { name: 'Meia perna', durationMinutes: 30, priceCents: 8_000 },
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
  })
})
