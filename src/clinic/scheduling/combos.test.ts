/**
 * DEC-080 — combos de variantes: cotação, validação e cópia na visita.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ValidationError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  listCombos,
  quoteVisit,
  readComboSnapshot,
  replaceServiceCombosOp,
  replaceServiceZonesOp,
  upsertResourceOp,
  upsertServiceOp,
  writeZoneSnapshots,
} from '../config'

function seed() {
  const clock = createControllableClock(Date.UTC(2024, 0, 1))
  const { db, close } = bootClinicDb({ clock })
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Dra. Paula Reis' }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 60,
      bufferMinutes: 15,
      variantKind: 'Zona',
      variantKindPlural: 'Zonas',
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
      { name: 'Axila', durationMinutes: 15, priceCents: 5000, audience: 'ambos' },
      { name: 'Buço', durationMinutes: 15, priceCents: 3500, audience: 'feminino' },
      { name: 'Meia perna', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
      { name: 'Peitoral', durationMinutes: 15, priceCents: 12000, audience: 'masculino' },
    ],
    clock,
  )
  const id = (name: string) => zones.find((z) => z.name === name)!.id
  const service = () => upsertServiceOp(db, caller, {
    id: svc.id,
    name: 'Depilação',
    durationMinutes: 60,
    bufferMinutes: 15,
    variantKind: 'Zona',
    variantKindPlural: 'Zonas',
    professionalIds: [pro.id],
    roomRequirement: { mode: 'none' },
  }, clock)
  return { db, close, clock, caller, svc, id, service }
}

describe('combos de variantes (DEC-080)', () => {
  it('aplica sozinho; as sobras saem pelo preço normal; guarda a cópia', () => {
    const { db, close, clock, caller, svc, id, service } = seed()
    try {
      replaceServiceCombosOp(
        db,
        caller,
        svc.id,
        [{ name: 'Buço + axila', priceCents: 7000, zoneIds: [id('Buço'), id('Axila')] }],
        clock,
      )
      const only = quoteVisit(db, caller.tenantId, service(), [id('Axila'), id('Buço')])
      expect(only).toMatchObject({ priceCents: 7000, durationMinutes: 30 })
      expect(only.combo).toMatchObject({ name: 'Buço + axila', priceCents: 7000, listPriceCents: 8500 })

      const withRest = quoteVisit(db, caller.tenantId, service(), [id('Axila'), id('Buço'), id('Meia perna')])
      expect(withRest.priceCents).toBe(7000 + 9000)

      const none = quoteVisit(db, caller.tenantId, service(), [id('Axila')])
      expect(none).toMatchObject({ priceCents: 5000, combo: null })

      writeZoneSnapshots(db, caller.tenantId, 'proposal', 'aprop_1', only.zones, only.combo)
      expect(readComboSnapshot(db, caller.tenantId, 'proposal', 'aprop_1')).toMatchObject({
        name: 'Buço + axila',
        listPriceCents: 8500,
      })
    } finally {
      close()
    }
  })

  it('deixa de valer quando o preço de uma variante faz o combo não compensar', () => {
    const { db, close, clock, caller, svc, id, service } = seed()
    try {
      replaceServiceCombosOp(
        db,
        caller,
        svc.id,
        [{ name: 'Buço + axila', priceCents: 7000, zoneIds: [id('Buço'), id('Axila')] }],
        clock,
      )
      replaceServiceZonesOp(
        db,
        caller,
        svc.id,
        [
          { id: id('Axila'), name: 'Axila', durationMinutes: 15, priceCents: 3000, audience: 'ambos' },
          { id: id('Buço'), name: 'Buço', durationMinutes: 15, priceCents: 3500, audience: 'feminino' },
          { id: id('Meia perna'), name: 'Meia perna', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
          { id: id('Peitoral'), name: 'Peitoral', durationMinutes: 15, priceCents: 12000, audience: 'masculino' },
        ],
        clock,
      )
      const quote = quoteVisit(db, caller.tenantId, service(), [id('Axila'), id('Buço')])
      expect(quote).toMatchObject({ priceCents: 6500, combo: null })
    } finally {
      close()
    }
  })

  it('recusa combo pequeno, misto, de outro serviço, sem preço ou repetido', () => {
    const { db, close, clock, caller, svc, id } = seed()
    try {
      const run = (combos: Parameters<typeof replaceServiceCombosOp>[3]) => () =>
        replaceServiceCombosOp(db, caller, svc.id, combos, clock)
      expect(run([{ name: 'Só um', priceCents: 1000, zoneIds: [id('Axila')] }])).toThrow(ValidationError)
      expect(
        run([{ name: 'Misto', priceCents: 1000, zoneIds: [id('Buço'), id('Peitoral')] }]),
      ).toThrow(/não mistura/)
      expect(run([{ name: 'Fora', priceCents: 1000, zoneIds: [id('Axila'), 'zona_de_outro'] }])).toThrow(
        ValidationError,
      )
      expect(run([{ name: 'Grátis', priceCents: 0, zoneIds: [id('Axila'), id('Buço')] }])).toThrow(
        ValidationError,
      )
      expect(
        run([
          { name: 'Dup', priceCents: 7000, zoneIds: [id('Axila'), id('Buço')] },
          { name: 'dup', priceCents: 7500, zoneIds: [id('Axila'), id('Meia perna')] },
        ]),
      ).toThrow(ValidationError)
      expect(listCombos(db, caller.tenantId, svc.id)).toEqual([])
    } finally {
      close()
    }
  })

  it('tirar uma variante apaga o combo que ficou com menos de 2; combo usado só se desativa', () => {
    const { db, close, clock, caller, svc, id, service } = seed()
    try {
      const [combo] = replaceServiceCombosOp(
        db,
        caller,
        svc.id,
        [
          { name: 'Buço + axila', priceCents: 7000, zoneIds: [id('Buço'), id('Axila')] },
          { name: 'Pernas', priceCents: 12000, zoneIds: [id('Meia perna'), id('Axila')] },
        ],
        clock,
      )
      const used = quoteVisit(db, caller.tenantId, service(), [id('Axila'), id('Buço')])
      writeZoneSnapshots(db, caller.tenantId, 'appointment', 'apt_1', used.zones, used.combo)

      expect(() => replaceServiceCombosOp(db, caller, svc.id, [], clock)).toThrow(/já entrou/)

      replaceServiceCombosOp(
        db,
        caller,
        svc.id,
        [{ id: combo!.id, name: combo!.name, priceCents: 7000, zoneIds: combo!.zoneIds, active: false }],
        clock,
      )
      expect(listCombos(db, caller.tenantId, svc.id)).toMatchObject([{ name: 'Buço + axila', active: false }])
      expect(quoteVisit(db, caller.tenantId, service(), [id('Axila'), id('Buço')]).combo).toBeNull()
    } finally {
      close()
    }
  })

  it('troca de nomes entre combos na mesma gravação', () => {
    const { db, close, clock, caller, svc, id } = seed()
    try {
      const [a, b] = replaceServiceCombosOp(
        db,
        caller,
        svc.id,
        [
          { name: 'A', priceCents: 7000, zoneIds: [id('Buço'), id('Axila')] },
          { name: 'B', priceCents: 12000, zoneIds: [id('Meia perna'), id('Axila')] },
        ],
        clock,
      )
      const swapped = replaceServiceCombosOp(
        db,
        caller,
        svc.id,
        [
          { id: a!.id, name: 'B', priceCents: 7000, zoneIds: a!.zoneIds },
          { id: b!.id, name: 'A', priceCents: 12000, zoneIds: b!.zoneIds },
        ],
        clock,
      )
      expect(swapped.map((c) => c.name)).toEqual(['B', 'A'])
    } finally {
      close()
    }
  })
})
