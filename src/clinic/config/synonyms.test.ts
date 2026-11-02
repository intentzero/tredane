import { describe, expect, it } from 'vitest'
import { createControllableClock, systemClock } from '../../db/clock'
import { CLINIC_SCHEMA_VERSION, ValidationError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { upsertServiceOp, replaceServiceZonesOp } from './operations'
import { getService } from './services'
import {
  normalizeSynonymList,
  SYNONYM_MAX_COUNT,
  textCitesNameOrSynonym,
} from './synonyms'
import { compileCatalog } from '../ai/turn-context'
import { resolveBookingObject } from '../ai/booking-object'
import { zonesNamedInText } from './zones'

function boot(tenantId = 'clinic-demo-a') {
  const { db, close } = bootClinicDb()
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  return { db, caller, tenantId, close }
}

describe('sinónimos DEC-110 (#421)', () => {
  it('migração 50 sobe CLINIC_SCHEMA_VERSION e cria colunas', () => {
    const s = boot()
    try {
      expect(CLINIC_SCHEMA_VERSION).toBe(51)
      const cols = s.db
        .all<{ name: string }>(`PRAGMA table_info(services)`)
        .map((c) => c.name)
      expect(cols).toContain('synonyms_json')
      const zcols = s.db
        .all<{ name: string }>(`PRAGMA table_info(service_zones)`)
        .map((c) => c.name)
      expect(zcols).toContain('synonyms_json')
    } finally {
      s.close()
    }
  })

  it('owner grava sinónimos no serviço e na variante', () => {
    const s = boot()
    try {
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Depilação',
          durationMinutes: 30,
          bufferMinutes: 0,
          professionalIds: [],
          roomRequirement: { mode: 'none' },
          synonyms: ['laser'],
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
        },
        systemClock,
      )
      expect(svc.synonyms).toEqual(['laser'])
      const zones = replaceServiceZonesOp(
        s.db,
        s.caller,
        svc.id,
        [
          {
            name: 'Lábio superior',
            durationMinutes: 10,
            priceCents: 3500,
            audience: 'ambos',
            synonyms: ['buço'],
          },
        ],
        systemClock,
      )
      expect(zones[0]!.synonyms).toEqual(['buço'])
      const loaded = getService(s.db, s.tenantId, svc.id)!
      expect(loaded.zones[0]!.synonyms).toEqual(['buço'])
    } finally {
      s.close()
    }
  })

  it('recusa sinónimo que colide com outro serviço', () => {
    const s = boot()
    try {
      upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Massagem',
          durationMinutes: 50,
          bufferMinutes: 0,
          professionalIds: [],
          roomRequirement: { mode: 'none' },
        },
        systemClock,
      )
      let err: unknown
      try {
        upsertServiceOp(
          s.db,
          s.caller,
          {
            name: 'Limpeza de pele',
            durationMinutes: 60,
            bufferMinutes: 0,
            professionalIds: [],
            roomRequirement: { mode: 'none' },
            synonyms: ['massagem'],
          },
          systemClock,
        )
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(ValidationError)
      expect((err as ValidationError).code).toBe('synonym_collision')
      expect((err as ValidationError).message).toMatch(/Massagem/)
    } finally {
      s.close()
    }
  })

  it('recusa lista longa, duplicados e comprimento inválido', () => {
    expect(() => normalizeSynonymList(['a'])).toThrow(ValidationError)
    expect(() => normalizeSynonymList(['ok', 'OK'])).toThrow(ValidationError)
    expect(() =>
      normalizeSynonymList(Array.from({ length: SYNONYM_MAX_COUNT + 1 }, (_, i) => `s${i}`)),
    ).toThrow(ValidationError)
  })

  it('«buço» resolve para Lábio superior; resposta usa o nome do catálogo', () => {
    const s = boot()
    try {
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Depilação',
          durationMinutes: 30,
          bufferMinutes: 0,
          professionalIds: [],
          roomRequirement: { mode: 'none' },
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
        },
        systemClock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        svc.id,
        [
          {
            name: 'Lábio superior',
            durationMinutes: 10,
            priceCents: 3500,
            audience: 'ambos',
            synonyms: ['buço'],
          },
          {
            name: 'Axila',
            durationMinutes: 15,
            priceCents: 4000,
            audience: 'ambos',
          },
        ],
        systemClock,
      )
      const loaded = getService(s.db, s.tenantId, svc.id)!
      const named = zonesNamedInText('quero buço', loaded.zones)
      expect(named.map((z) => z.name)).toEqual(['Lábio superior'])

      const match = resolveBookingObject({
        text: 'Quero buço',
        services: [loaded],
        conversationId: 'cnv_syn',
      })
      expect(match.kind).toBe('selected')
      expect(match.variantIds).toEqual([loaded.zones[0]!.id])
      expect(match.candidates[0]!.variantName).toBe('Lábio superior')
      expect(match.question ?? '').not.toMatch(/buço/i)

      const catalog = compileCatalog([loaded], [], '1')
      expect(catalog.serviceIdsByNormName.get('depilacao')).toEqual([loaded.id])
      expect(catalog.zoneIdsByNormAlias.get('buco')).toEqual([
        { serviceId: loaded.id, zoneId: loaded.zones[0]!.id },
      ])
      // Enums #416: nomes canónicos separados dos aliases.
      expect(catalog.serviceIdsByNormAlias.has('depilacao')).toBe(false)
    } finally {
      s.close()
    }
  })

  it('textCitesNameOrSynonym reconhece sinónimo sem ecoar o nome', () => {
    expect(textCitesNameOrSynonym('quero buço amanhã', 'Lábio superior', ['buço'])).toBe(true)
    expect(textCitesNameOrSynonym('quero axila', 'Lábio superior', ['buço'])).toBe(false)
  })

  it('replaceZones bumpa services.updated_at (cache do catálogo)', () => {
    const clock = createControllableClock(1_700_000_000_000)
    const { db, close } = bootClinicDb({ clock })
    const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
    try {
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Depilação',
          durationMinutes: 30,
          bufferMinutes: 0,
          professionalIds: [],
          roomRequirement: { mode: 'none' },
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
        },
        clock,
      )
      replaceServiceZonesOp(
        db,
        caller,
        svc.id,
        [
          {
            name: 'Axila',
            durationMinutes: 15,
            priceCents: 4000,
            audience: 'ambos',
          },
        ],
        clock,
      )
      const before = getService(db, 'clinic-demo-a', svc.id)!.updatedAt
      clock.advance(5_000)
      // Só sinónimos — sem upsertService. Tem de invalidar o cache (#421 M2).
      replaceServiceZonesOp(
        db,
        caller,
        svc.id,
        [
          {
            id: getService(db, 'clinic-demo-a', svc.id)!.zones[0]!.id,
            name: 'Axila',
            durationMinutes: 15,
            priceCents: 4000,
            audience: 'ambos',
            synonyms: ['axilas'],
          },
        ],
        clock,
      )
      const after = getService(db, 'clinic-demo-a', svc.id)!
      expect(after.updatedAt).toBeGreaterThan(before)
      expect(after.zones[0]!.synonyms).toEqual(['axilas'])
    } finally {
      close()
    }
  })
})
