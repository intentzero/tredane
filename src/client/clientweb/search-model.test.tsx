import { describe, expect, it } from 'vitest'
import type { Catalog, CatalogService } from './api'
import { filterZones, foldText, lightSingular, matchesQuery, searchCatalog } from './search-model'

const svc = (o: Partial<CatalogService> & { id: string; name: string }): CatalogService => ({
  synonyms: [], durationMinutes: 60, priceCents: 12_000, audience: 'qualquer', variantKind: null, variantKindPlural: null, variantSelection: 'varias', requiresSignal: false, zones: [], professionals: [], ...o,
})
const laser = svc({
  id: 'laser', name: 'Depilação a laser', synonyms: ['laser'], variantKind: 'Zona', variantKindPlural: 'Zonas',
  zones: [
    { id: 'ax', name: 'Axilas', synonyms: ['sovaco'], audience: 'feminino', durationMinutes: 10, priceCents: 9_000 },
    { id: 'ba', name: 'Barba', synonyms: [], audience: 'masculino', durationMinutes: 30, priceCents: 8_000 },
    { id: 'so', name: 'Sobrancelha', synonyms: [], audience: 'ambos', durationMinutes: 15, priceCents: 3_000 },
  ],
})
const cera = svc({ id: 'cera', name: 'Depilação com cera', zones: [{ id: 'ax2', name: 'Axilas', synonyms: [], audience: 'ambos', durationMinutes: 15, priceCents: 4_500 }] })
const limpeza = svc({ id: 'limpeza', name: 'Limpeza de pele', synonyms: ['limpeza facial', 'peeling'] })
const catalog: Catalog = { timezone: 'America/Sao_Paulo', horizonDays: 30, today: '2026-11-17', services: [laser, cera, limpeza] }

describe('pesquisa (DEC-200)', () => {
  it('ignora acentos, maiúsculas e plural leve', () => {
    expect(foldText('  Depilação  A Laser! ')).toBe('depilacao a laser')
    expect(lightSingular('axilas')).toBe('axila')
    expect(lightSingular('gas')).toBe('gas')
    expect(matchesQuery('axila', ['Axilas'])).toBe(true)
    expect(matchesQuery('AXILAS', ['axila'])).toBe(true)
    expect(matchesQuery('depilacao', ['Depilação a laser'])).toBe(true)
    expect(matchesQuery('sobran', ['Sobrancelha'])).toBe(true)
    expect(matchesQuery('botox', ['Sobrancelha'])).toBe(false)
    expect(matchesQuery('', ['Axilas'])).toBe(false)
  })

  it('todas as palavras têm de casar (laser axila)', () => {
    expect(matchesQuery('depilacao laser', ['Depilação a laser'])).toBe(true)
    expect(matchesQuery('depilacao cera', ['Depilação a laser'])).toBe(false)
  })

  it('casa pelos sinónimos sem os mostrar: «sovaco» acha Axilas, «peeling» acha a limpeza', () => {
    const r = searchCatalog(catalog, catalog.services, 'feminino', 'sovaco')
    expect(r.groups.map((g) => [g.service.id, g.zones.map((z) => z.id)])).toEqual([['laser', ['ax']]])
    expect(searchCatalog(catalog, catalog.services, null, 'peeling').groups.map((g) => g.service.id)).toEqual(['limpeza'])
  })

  it('«axila» dá a mesma zona em dois serviços, agrupada por serviço', () => {
    const r = searchCatalog(catalog, catalog.services, 'feminino', 'axila')
    expect(r.groups.map((g) => [g.service.name, g.zones.map((z) => z.id), g.combos])).toEqual([
      ['Depilação a laser', ['ax'], []],
      ['Depilação com cera', ['ax2'], []],
    ])
  })

  it('só mostra zonas da linha escolhida', () => {
    expect(searchCatalog(catalog, catalog.services, 'feminino', 'barba').groups).toEqual([])
    expect(searchCatalog(catalog, catalog.services, 'masculino', 'barba').groups.map((g) => g.zones.map((z) => z.id))).toEqual([['ba']])
  })

  it('serviço que casa pelo nome aparece mesmo sem zonas casadas', () => {
    const r = searchCatalog(catalog, catalog.services, 'feminino', 'limpeza')
    expect(r.groups).toEqual([{ service: limpeza, zones: [], combos: [], serviceMatched: true }])
    expect(searchCatalog(catalog, catalog.services, 'feminino', 'botox')).toEqual({ groups: [], count: 0 })
  })

  it('casa combo pelo nome e pelas zonas que inclui (DEC-080)', () => {
    const withCombo = svc({
      id: 'laser2',
      name: 'Depilação a laser',
      variantKind: 'Zona',
      variantKindPlural: 'Zonas',
      zones: [
        { id: 'ax', name: 'Axilas', synonyms: [], audience: 'feminino', durationMinutes: 10, priceCents: 9_000 },
        { id: 'vi', name: 'Virilha', synonyms: [], audience: 'feminino', durationMinutes: 20, priceCents: 14_000 },
        { id: 'bu', name: 'Buço', synonyms: [], audience: 'feminino', durationMinutes: 5, priceCents: 5_000 },
      ],
      combos: [{ id: 'verao', name: 'Pacote verão', priceCents: 22_000, zoneIds: ['ax', 'vi', 'bu'] }],
    })
    const cat: Catalog = { ...catalog, services: [withCombo] }
    const byName = searchCatalog(cat, cat.services, 'feminino', 'verao')
    expect(byName.groups.map((g) => g.combos.map((c) => c.id))).toEqual([['verao']])
    const byZone = searchCatalog(cat, cat.services, 'feminino', 'axila')
    expect(byZone.groups[0]?.combos.map((c) => c.id)).toEqual(['verao'])
    expect(byZone.groups[0]?.zones.map((z) => z.id)).toEqual(['ax'])
  })

  it('filtra as zonas de um serviço', () => {
    expect(filterZones(laser.zones, 'sovac').map((z) => z.id)).toEqual(['ax'])
    expect(filterZones(laser.zones, '  ').length).toBe(3)
  })
})

import { highlightRange } from './search-model'

describe('realce do termo', () => {
  it('realça o prefixo casado, com acentos e plural leve', () => {
    expect(highlightRange('Axilas', 'axila')).toEqual([0, 5])
    expect(highlightRange('Depilação a laser', 'depilacao')).toEqual([0, 9])
    expect(highlightRange('Pacote verão', 'verao')).toEqual([7, 12])
    expect(highlightRange('Axilas', 'botox')).toBeNull()
    expect(highlightRange('Axilas', '')).toBeNull()
  })
})
