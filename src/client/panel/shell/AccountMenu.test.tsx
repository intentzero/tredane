import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AccountMenu, accountInitials } from './AccountMenu'

describe('accountInitials', () => {
  it('usa primeira e última inicial do nome', () => {
    expect(accountInitials('Paulo dos Santos', 'x@y.z')).toBe('PS')
    expect(accountInitials('ana', null)).toBe('A')
  })
  it('cai para o e-mail e depois vazio', () => {
    expect(accountInitials('  ', 'bruno@ex.com')).toBe('B')
    expect(accountInitials(null, null)).toBe('')
  })
})

describe('AccountMenu', () => {
  it('abre com nome/e-mail, Esc fecha e devolve foco, Sair chama onSignOut', async () => {
    const user = userEvent.setup()
    const onSignOut = vi.fn()
    render(<AccountMenu name="Paulo dos Santos" email="paulo@ex.com" onSignOut={onSignOut} />)
    const trigger = screen.getByRole('button', { name: /Conta: Paulo dos Santos/ })
    expect(trigger.textContent).toBe('PS')
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull()

    await user.click(trigger)
    expect(await screen.findByRole('menu')).toBeTruthy()
    expect(screen.getByText('paulo@ex.com')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(onSignOut).not.toHaveBeenCalled()

    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: 'Sair' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('sem dados mostra ícone e rótulo genérico', () => {
    render(<AccountMenu onSignOut={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Conta: sua conta/ }).querySelector('svg')).toBeTruthy()
  })
})
