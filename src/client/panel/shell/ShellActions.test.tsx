import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

import { ShellActions } from './ShellActions'

describe('ShellActions', () => {
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
    await user.click(screen.getByRole('button', { name: 'Avisos no celular' }))
    expect(navigatePanel).toHaveBeenCalledWith({
      kind: 'area',
      area: 'avisos',
      tenantId: 'clinic-a',
    })
  })
})
