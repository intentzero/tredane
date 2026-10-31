// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClinicConfigSnapshot, PanelApi } from '../../api'
import { ServiceForm } from './ServicesScreen'

afterEach(cleanup)

const snap = {
  services: [],
  resources: [{ id: 'pro', kind: 'professional', name: 'Gi', active: true, futureAppointmentCount: 0 }],
  settings: {},
  weeklyWindows: [],
  blocks: [],
  readiness: { missing: [], counts: { servicesActive: 0, professionalsActive: 1, roomsActive: 0, resourcesWithWeekly: 0 } },
} as unknown as ClinicConfigSnapshot

describe('ficha do serviço — Tempo (M-53)', () => {
  it('abre a folha Tempo e só pede graus em Acima de, sem percentagem', () => {
    render(
      <ServiceForm
        tenantId="clinic-demo-a"
        entityId="novo"
        snap={snap}
        api={{} as PanelApi}
        generation={1}
        onSaved={async () => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /Tempo/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Tempo/i }))
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy()
    expect(screen.getByText('Sem restrição de tempo.')).toBeTruthy()
    expect(screen.queryByLabelText('Graus (°C)')).toBeNull()
    expect(document.body.textContent).not.toMatch(/percentagem/)
    fireEvent.click(screen.getByRole('radio', { name: 'Acima de' }))
    expect(screen.getByLabelText('Graus (°C)')).toBeTruthy()
    expect(screen.queryByText('Sem restrição de tempo.')).toBeNull()
  })
})
