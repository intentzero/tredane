import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClinicConfigSnapshot, ClinicResource } from '../../api'
import { panelHref, resolvePanelRoute, type PanelRoute } from '../../routes'
import { ClinicTabs } from './ClinicTabs'
import { ResourcesList } from './ResourcesScreen'

afterEach(cleanup)

const r = (o: Partial<ClinicResource>): ClinicResource =>
  ({
    id: 'x', kind: 'professional', name: 'X', category: null, active: true,
    futureAppointmentCount: 0, hasAppointmentHistory: false, createdAt: 0, updatedAt: 0, ...o,
  }) as ClinicResource

const snap = {
  settings: { tenantId: 't', timezone: 'America/Sao_Paulo', updatedAt: 0 },
  resources: [
    r({ id: 'p1', name: 'Dra. Fictícia Lima' }),
    r({ id: 's1', kind: 'room', name: 'Sala depilação' }),
  ],
  services: [], weeklyWindows: [], blocks: [],
} as unknown as ClinicConfigSnapshot

/** Espelha ClinicArea: separador e lista lidos da mesma rota. */
function Harness() {
  const [route, setRoute] = useState<PanelRoute | null>(() => resolvePanelRoute(window.location.pathname))
  useEffect(() => {
    const on = () => setRoute(resolvePanelRoute(window.location.pathname))
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  if (!route || route.kind !== 'area' || route.area !== 'clinica') return null
  const tab = route.entityId === 'salas' ? 'room' : 'professional'
  return (
    <>
      <ClinicTabs tenantId="t" section={route.section} entityId={route.entityId} />
      <ResourcesList key={tab} tenantId="t" snap={snap} tab={tab} />
    </>
  )
}

function expectTab(which: 'Profissionais' | 'Salas') {
  const selected = screen.getByRole('tab', { selected: true })
  expect(selected.textContent).toBe(which)
  if (which === 'Salas') {
    expect(screen.getByText('Sala depilação')).toBeTruthy()
    expect(screen.getByText('Adicionar sala')).toBeTruthy()
    expect(screen.queryByText('Dra. Fictícia Lima')).toBeNull()
  } else {
    expect(screen.getByText('Dra. Fictícia Lima')).toBeTruthy()
    expect(screen.getByText('Adicionar profissional')).toBeTruthy()
    expect(screen.queryByText('Sala depilação')).toBeNull()
  }
}

describe('Recursos — separadores seguem a rota', () => {
  it('base → Salas → Profissionais → voltar no navegador', async () => {
    const base = panelHref({ kind: 'area', area: 'clinica', tenantId: 't', section: 'recursos' })
    window.history.replaceState(null, '', base)
    render(<Harness />)
    expectTab('Profissionais')

    fireEvent.click(screen.getByRole('tab', { name: 'Salas' }))
    expect(window.location.pathname).toMatch(/\/recursos\/salas$/)
    expectTab('Salas')

    fireEvent.click(screen.getByRole('tab', { name: 'Profissionais' }))
    expectTab('Profissionais')

    await act(async () => {
      await new Promise<void>((res) => {
        window.addEventListener('popstate', () => res(), { once: true })
        window.history.back()
      })
    })
    expect(window.location.pathname).toMatch(/\/recursos\/salas$/)
    expectTab('Salas')
  })

  it('botões móveis também navegam (sem estado local)', () => {
    window.history.replaceState(null, '', panelHref({ kind: 'area', area: 'clinica', tenantId: 't', section: 'recursos' }))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Salas e equipamentos' }))
    expect(window.location.pathname).toMatch(/\/recursos\/salas$/)
    expectTab('Salas')
  })
})
