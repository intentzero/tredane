/**
 * «relaxar» ~ «relaxante»: radical em comum, USO ESTREITO (DEC-110/141). Staging 14/11/2026.
 * Só entra quando uma zona citada, sem serviço citado, ia decidir sozinha.
 */
import { describe, expect, it } from 'vitest'
import { resolveBookingObject } from './booking-object'
import { EVAL_BOOKING_CATALOG } from './evals/booking-object-catalog'
import type { ServiceRow } from '../config/types'

/** Catálogo de referência com a zona «Costas» na Depilação, como em staging. */
const CATALOG: ServiceRow[] = EVAL_BOOKING_CATALOG.map((s) =>
  s.id !== 'svc-depilacao'
    ? s
    : {
        ...s,
        zones: [
          ...s.zones,
          { ...s.zones[0]!, id: 'z-costas', name: 'Costas', audience: 'ambos' as const, sortOrder: 9, synonyms: [] },
        ],
      },
)

const run = (text: string) => {
  const r = resolveBookingObject({ text, services: CATALOG })
  return { kind: r.kind, serviceId: r.serviceId, services: [...new Set(r.candidates.map((c) => c.serviceId))].sort() }
}

describe('radical em comum, só quando uma zona compete', () => {
  it('«relaxar as costas»: a zona já não decide sozinha, Massagem relaxante entra na disputa', () => {
    const r = run('queria relaxar as costas')
    expect(r.kind).toBe('clarify')
    expect(r.services).toEqual(['svc-depilacao', 'svc-massagem-60'])
  })

  it('«depilar as costas» e «costas» continuam a ser a zona de Depilação', () => {
    expect(run('quero depilar as costas').serviceId).toBe('svc-depilacao')
    expect(run('quero as costas').services).toEqual(['svc-depilacao'])
  })

  it('sem zona a competir, o verbo sozinho continua por reconhecer (DEC-110/141)', () => {
    expect(run('quero relaxar').kind).not.toBe('selected')
    expect(run('quero relaxar').services).not.toContain('svc-massagem-60')
    expect(run('quero depilar').services).not.toContain('svc-depilacao')
  })

  it('palavras curtas não criam radical («massa» ~ «massagem»)', () => {
    expect(run('massa pras costas').services).not.toContain('svc-massagem')
  })

  it('verbo de funil «marcar» não empata com serviço «Marcação…»', () => {
    const base = CATALOG.find((s) => s.id === 'svc-depilacao')!
    const withMarcacao: ServiceRow[] = [
      ...CATALOG,
      {
        ...base,
        id: 'svc-marcacao',
        name: 'Marcação express',
        zones: [],
        synonyms: [],
      },
    ]
    const r = resolveBookingObject({ text: 'quero marcar as costas', services: withMarcacao })
    const services = [...new Set(r.candidates.map((c) => c.serviceId))]
    expect(services).not.toContain('svc-marcacao')
    expect(r.serviceId ?? services[0]).toBe('svc-depilacao')
  })
})
