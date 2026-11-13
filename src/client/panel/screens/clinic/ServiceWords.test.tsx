import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClinicConfigSnapshot, ClinicService } from '../../api'
import { panelHref, resolvePanelRoute } from '../../routes'
import { ServiceWords, wordRows } from './ServiceWords'

afterEach(cleanup)

function svc(over: Partial<ClinicService>): ClinicService {
  return {
    id: 'svc_1',
    name: 'Serviço fictício',
    durationMinutes: 60,
    bufferMinutes: 0,
    occupiedMinutes: 60,
    priceCents: null,
    clientExplanation: null,
    active: true,
    requiresSignal: false,
    signalKind: null,
    signalFixedCents: null,
    signalPercent: null,
    professionalIds: [],
    roomRequirement: { mode: 'none' },
    deletable: true,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

const zone = (id: string, name: string, audience: 'ambos' | 'feminino' | 'masculino', synonyms: string[]) => ({
  id,
  name,
  durationMinutes: 10,
  priceCents: 5_000,
  audience,
  active: true,
  sortOrder: 0,
  synonyms,
})

const services = [
  svc({
    id: 'dep',
    name: 'Depilação',
    synonyms: ['depilar'],
    variantKind: 'Zona',
    variantKindPlural: 'Zonas',
    zones: [
      zone('z1', 'Axila', 'feminino', ['sovaco']),
      zone('z2', 'Axila', 'masculino', ['sovaco']),
      zone('z3', 'Pernas', 'feminino', []),
    ],
  }),
  svc({
    id: 'mas',
    name: 'Massagem',
    variantKind: 'Tipo',
    variantKindPlural: 'Tipos',
    zones: [zone('m1', 'Relaxante', 'ambos', ['pernas'])],
  }),
  svc({ id: 'old', name: 'Antigo', active: false, synonyms: ['velho'] }),
]

describe('O que a IA reconhece (DEC-176)', () => {
  it('lista serviços ativos e opções agrupadas pelo nome', () => {
    const rows = wordRows(services)
    expect(rows.map((r) => r.title)).toEqual([
      'Depilação',
      'Depilação › Axila',
      'Depilação › Pernas',
      'Massagem',
      'Massagem › Relaxante',
    ])
    expect(rows[1]!.words).toEqual(['sovaco'])
    expect(rows[1]!.kind).toBe('Zona')
  })

  it('avisa a palavra repetida dos dois lados, mas não nomes iguais', () => {
    const rows = wordRows(services)
    expect(rows.find((r) => r.title === 'Massagem › Relaxante')!.warnings).toEqual([
      { word: 'pernas', other: 'Depilação › Pernas' },
    ])
    expect(rows.find((r) => r.title === 'Depilação › Pernas')!.warnings).toEqual([
      { word: 'Pernas', other: 'Massagem › Relaxante' },
    ])
    expect(rows.find((r) => r.title === 'Depilação › Axila')!.warnings).toEqual([])
  })

  it('procura por nome ou palavra e mostra o resumo', () => {
    const snap = { services } as unknown as ClinicConfigSnapshot
    render(<ServiceWords tenantId="t" snap={snap} />)
    expect(screen.getByRole('status').textContent).toBe('5 nomes · 2 sem outras palavras · 2 com palavra repetida')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Procurar palavra' }), { target: { value: 'sovaco' } })
    const list = screen.getByRole('list', { name: 'Nomes e palavras' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('Depilação › Axila')).toBeTruthy()
    expect(within(list).getByRole('button', { name: 'Editar Depilação › Axila' })).toBeTruthy()
  })

  it('tem rota própria dentro de Serviços', () => {
    const route = resolvePanelRoute('/c/t/clinica/servicos/palavras')
    expect(route).toMatchObject({ kind: 'area', area: 'clinica', section: 'palavras' })
    expect(panelHref({ kind: 'area', area: 'clinica', tenantId: 't', section: 'palavras' })).toBe(
      '/c/t/clinica/servicos/palavras',
    )
  })
})
