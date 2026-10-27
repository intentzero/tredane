import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markPickingClinic, writeLastTenantId } from '../auth/session'
import { ClinicSelector } from './ClinicSelector'

const selectTenant = vi.fn()
const navigatePanel = vi.fn()
const tenants = [
  { tenantId: 'clinic-a', name: 'Clínica A', role: 'owner' as const },
  { tenantId: 'clinic-b', name: 'Clínica B', role: 'attendant' as const },
]

vi.mock('../auth/ClerkBridge', () => ({ SignOutButton: () => null }))
vi.mock('../routes', () => ({ navigatePanel: (...a: unknown[]) => navigatePanel(...a) }))
vi.mock('../tenant/TenantContext', () => ({
  useTenant: () => ({
    listState: { phase: 'ready', tenants },
    active: { phase: 'none' },
    selectTenant,
  }),
}))

describe('ClinicSelector — retomar a última clínica', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    selectTenant.mockReset().mockResolvedValue(true)
    navigatePanel.mockReset()
  })
  afterEach(cleanup)

  it('reabre sozinho a última clínica quando ela está na lista', async () => {
    writeLastTenantId('clinic-b')
    render(<ClinicSelector />)
    await waitFor(() => expect(selectTenant).toHaveBeenCalledWith('clinic-b', 'Clínica B'))
    await waitFor(() =>
      expect(navigatePanel).toHaveBeenCalledWith(
        { kind: 'area', area: 'conversas', tenantId: 'clinic-b', section: 'lista' },
        true,
      ),
    )
  })

  it('se não conseguir reabrir a última clínica, não navega e guarda o registro', async () => {
    selectTenant.mockResolvedValue(false)
    writeLastTenantId('clinic-b')
    render(<ClinicSelector />)
    await waitFor(() => expect(selectTenant).toHaveBeenCalledTimes(1))
    expect(navigatePanel).not.toHaveBeenCalled()
    expect(localStorage.getItem('tredane.lastTenantId')).toBe('clinic-b')
  })

  it('mostra a lista se a última clínica não é desta pessoa', () => {
    writeLastTenantId('clinic-de-outra-pessoa')
    render(<ClinicSelector />)
    expect(screen.getByText('Escolha a clínica')).toBeTruthy()
    expect(selectTenant).not.toHaveBeenCalled()
  })

  it('mostra a lista depois de «Trocar clínica»', () => {
    writeLastTenantId('clinic-b')
    markPickingClinic()
    render(<ClinicSelector />)
    expect(screen.getByText('Escolha a clínica')).toBeTruthy()
    expect(selectTenant).not.toHaveBeenCalled()
  })
})
