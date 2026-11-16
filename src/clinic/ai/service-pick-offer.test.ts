import { describe, expect, it } from 'vitest'
import { SERVICE_LIST_BUTTON_LABEL } from './choice-offer'
import { buildServicePickOffer } from './service-pick-offer'
import type { ServiceRow } from '../config/types'

function svc(id: string, name: string): ServiceRow {
  return {
    id,
    name,
    active: true,
    durationMinutes: 30,
    bufferMinutes: 0,
    priceCents: 1000,
    professionalIds: [],
    roomRequirement: { mode: 'none' },
    zones: [],
    variantKind: null,
    variantKindPlural: null,
    variantSelection: 'uma',
    audiencia: 'qualquer',
    synonyms: null,
  } as ServiceRow
}

describe('buildServicePickOffer', () => {
  it('≥4 serviços → lista WhatsApp (≤10 linhas)', () => {
    const services = Array.from({ length: 10 }, (_, i) => svc(`s${i}`, `Serviço ${i + 1}`))
    const pick = buildServicePickOffer({ services, catalogVersion: 'cat-t' })
    expect(pick?.interactive?.mode).toBe('list')
    if (pick?.interactive?.mode === 'list') {
      expect(pick.interactive.button).toBe(SERVICE_LIST_BUTTON_LABEL)
      expect(pick.interactive.sections[0]?.rows).toHaveLength(10)
    }
  })

  it('3 serviços → botões reply', () => {
    const services = [svc('a', 'Alpha'), svc('b', 'Beta'), svc('c', 'Gamma')]
    const pick = buildServicePickOffer({ services, catalogVersion: 'cat-t' })
    expect(pick?.interactive?.mode).toBe('buttons')
  })

  it('1 serviço → null (sem oferta interativa)', () => {
    expect(buildServicePickOffer({ services: [svc('a', 'Solo')], catalogVersion: 'cat-t' })).toBeNull()
  })
})