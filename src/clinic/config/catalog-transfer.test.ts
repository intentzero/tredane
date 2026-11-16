import { describe, expect, it } from 'vitest'
import { bootClinicDb } from '../test-db'
import { workerCaller } from '../envelopes'
import {
  exportClinicCatalogOp,
  importClinicCatalogOp,
  upsertResourceOp,
  upsertServiceOp,
  replaceServiceZonesOp,
} from './operations'
import { listServices, listResources } from './index'

describe('catalog-transfer — reconciliação', () => {
  it('cria profissional e serviço noutro tenant lógico com fusão por nome', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a', 'owner-a')
      const pro = upsertResourceOp(
        db,
        caller,
        { kind: 'professional', name: 'Ana Demo' },
        clock,
      )
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Massagem',
          durationMinutes: 60,
          bufferMinutes: 0,
          professionalIds: [pro.id],
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
            name: 'Costas',
            durationMinutes: 30,
            priceCents: 8000,
            audience: 'ambos',
          },
          {
            name: 'Pernas',
            durationMinutes: 40,
            priceCents: 10000,
            audience: 'feminino',
          },
        ],
        clock,
      )

      const doc = exportClinicCatalogOp(
        db,
        caller,
        { services: true, professionals: true },
        clock,
      )
      expect(doc.services[0]?.zones).toHaveLength(2)

      // Simula destino: mesmo DO/tenant após limpar? Usamos import no mesmo tenant
      // com nomes iguais → update; e um serviço novo no ficheiro.
      const mutated = {
        ...doc,
        services: [
          ...doc.services,
          {
            ...doc.services[0]!,
            id: 'svc_ficcao_nova',
            name: 'Drenagem',
            zones: [],
            combos: [],
            professionalIds: [pro.id],
            synonyms: [],
          },
        ],
      }

      const dry = importClinicCatalogOp(db, caller, mutated, clock, {
        dryRun: true,
        scopes: { services: true, professionals: true },
      })
      expect(dry.items.find((i) => i.name === 'Massagem')?.action).toBe('update')
      expect(dry.items.find((i) => i.name === 'Drenagem')?.action).toBe('create')
      expect(listServices(db, 'clinic-demo-a')).toHaveLength(1)

      const applied = importClinicCatalogOp(db, caller, mutated, clock, {
        dryRun: false,
        scopes: { services: true, professionals: true },
      })
      expect(applied.dryRun).toBe(false)
      expect(listServices(db, 'clinic-demo-a').map((s) => s.name).sort()).toEqual([
        'Drenagem',
        'Massagem',
      ])
      expect(
        listResources(db, 'clinic-demo-a', clock).filter((r) => r.kind === 'professional'),
      ).toHaveLength(1)
    } finally {
      close()
    }
  })
})
