import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../auth/ClerkBridge', () => ({
  AccountControl: ({ placement }: { placement?: string }) => (
    <button type="button" data-placement={placement ?? 'bottom end'}>
      Conta
    </button>
  ),
}))

const navigatePanel = vi.fn()
vi.mock('../routes', async () => {
  const actual = await vi.importActual<typeof import('../routes')>('../routes')
  return {
    ...actual,
    navigatePanel: (...args: unknown[]) => navigatePanel(...args),
  }
})

const getExistingPushSubscription = vi.fn()
vi.mock('../pwa', () => ({
  getExistingPushSubscription: (...a: unknown[]) => getExistingPushSubscription(...a),
  PUSH_SUBSCRIPTION_CHANGED_EVENT: 'tredane:push-subscription-changed',
}))

import { ShellActions } from './ShellActions'

describe('ShellActions', () => {
  beforeEach(() => {
    getExistingPushSubscription.mockReset().mockResolvedValue(null)
  })

  afterEach(() => {
    cleanup()
    navigatePanel.mockReset()
  })

  it('abre avisos e expõe a conta com a placement pedida', async () => {
    const user = userEvent.setup()
    render(
      <ShellActions
        className="panel-nav-actions"
        tenantId="clinic-a"
        accountPlacement="top"
      />,
    )
    expect(screen.getByRole('button', { name: 'Conta' }).getAttribute('data-placement')).toBe(
      'top',
    )
    // Enquanto carrega: label indeterminado; depois OFF (sem subscrição).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Avisos desligados — abrir Avisos' })).toBeTruthy(),
    )
    await user.click(screen.getByRole('button', { name: 'Avisos desligados — abrir Avisos' }))
    expect(navigatePanel).toHaveBeenCalledWith({
      kind: 'area',
      area: 'avisos',
      tenantId: 'clinic-a',
    })
  })

  it('mostra BellOff vermelho quando não há subscrição push', async () => {
    getExistingPushSubscription.mockResolvedValue(null)
    const { container } = render(
      <ShellActions className="panel-nav-actions" tenantId="clinic-a" />,
    )
    const btn = await screen.findByRole('button', {
      name: 'Avisos desligados — abrir Avisos',
    })
    expect(btn.className).toContain('panel-icon-btn--avisos-off')
    expect(container.querySelector('svg.lucide-bell-off')).toBeTruthy()
  })

  it('mostra Bell verde quando há subscrição push', async () => {
    getExistingPushSubscription.mockResolvedValue({ endpoint: 'https://push.example/x' })
    const { container } = render(
      <ShellActions className="panel-nav-actions" tenantId="clinic-a" />,
    )
    const btn = await screen.findByRole('button', {
      name: 'Avisos ligados — abrir Avisos',
    })
    expect(btn.className).toContain('panel-icon-btn--avisos-on')
    expect(container.querySelector('svg.lucide-bell-off')).toBeNull()
    expect(container.querySelector('svg.lucide-bell')).toBeTruthy()
  })

  it('atualiza o sino quando a subscrição muda', async () => {
    getExistingPushSubscription.mockResolvedValue(null)
    render(<ShellActions className="panel-nav-actions" tenantId="clinic-a" />)
    await screen.findByRole('button', { name: 'Avisos desligados — abrir Avisos' })

    getExistingPushSubscription.mockResolvedValue({ endpoint: 'https://push.example/y' })
    window.dispatchEvent(new Event('tredane:push-subscription-changed'))

    expect(
      await screen.findByRole('button', { name: 'Avisos ligados — abrir Avisos' }),
    ).toBeTruthy()
  })
})
