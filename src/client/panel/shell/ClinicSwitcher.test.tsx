// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClinicSwitcher } from './ClinicSwitcher'

const navigatePanel = vi.fn()

vi.mock('../routes', async (orig) => ({
  ...(await orig<typeof import('../routes')>()),
  navigatePanel: (...a: unknown[]) => navigatePanel(...a),
}))

const tenants = [
  { tenantId: 'clinic-a', name: 'Clínica Bella Pele', role: 'owner' as const, status: 'active' as const },
  { tenantId: 'clinic-b', name: 'Espaço Vita', role: 'attendant' as const, status: 'active' as const },
]

function stubPhone(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: phone && query.includes('max-width'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  )
}

describe('ClinicSwitcher (DEC-017: troca explícita)', () => {
  beforeEach(() => {
    navigatePanel.mockReset()
    stubPhone(false)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('com uma só clínica o nome é texto, sem botão', () => {
    render(
      <ClinicSwitcher tenantId="clinic-a" name="Clínica Bella Pele" area="conversas" tenants={[tenants[0]!]} />,
    )
    expect(screen.getByText('Clínica Bella Pele')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('desktop: o menu lista as clínicas com o papel, marca a atual e troca na mesma área', async () => {
    const user = userEvent.setup()
    render(
      <ClinicSwitcher tenantId="clinic-a" name="Clínica Bella Pele" area="agenda" tenants={tenants} />,
    )
    await user.click(screen.getByRole('button', { name: /Trocar de clínica/ }))
    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('Responsável'),
      expect.stringContaining('Atendente'),
    ])
    expect(items[0]?.getAttribute('aria-checked')).toBe('true')
    expect(items[1]?.getAttribute('aria-checked')).toBe('false')

    await user.click(items[1]!)
    // Só navega: o PanelRouter faz o selectTenant da rota nova (chamá-lo daqui desfaz a troca).
    await waitFor(() =>
      expect(navigatePanel).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'area', area: 'agenda', tenantId: 'clinic-b' }),
      ),
    )
  })

  it('de Clínica para uma clínica onde é atendente, abre Conversas (a configuração é só do responsável)', async () => {
    const user = userEvent.setup()
    render(
      <ClinicSwitcher tenantId="clinic-a" name="Clínica Bella Pele" area="clinica" tenants={tenants} />,
    )
    await user.click(screen.getByRole('button', { name: /Trocar de clínica/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: /Espaço Vita/ }))
    await waitFor(() =>
      expect(navigatePanel).toHaveBeenCalledWith(
        expect.objectContaining({ area: 'conversas', tenantId: 'clinic-b' }),
      ),
    )
  })

  it('tocar na clínica atual não troca', async () => {
    const user = userEvent.setup()
    render(
      <ClinicSwitcher tenantId="clinic-a" name="Clínica Bella Pele" area="conversas" tenants={tenants} />,
    )
    await user.click(screen.getByRole('button', { name: /Trocar de clínica/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: /Bella Pele/ }))
    expect(navigatePanel).not.toHaveBeenCalled()
  })

  it('celular: abre uma folha de baixo com as clínicas e troca ao escolher', async () => {
    stubPhone(true)
    const user = userEvent.setup()
    render(
      <ClinicSwitcher tenantId="clinic-a" name="Clínica Bella Pele" area="conversas" tenants={tenants} />,
    )
    await user.click(screen.getByRole('button', { name: /Trocar de clínica/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Trocar de clínica' })
    const radios = within(dialog).getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true')
    await user.click(radios[1]!)
    await waitFor(() =>
      expect(navigatePanel).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'clinic-b' })),
    )
  })
})
