import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import { ClientesList } from './ClientesList'

function mockApi(contacts: Array<{ id: string; waId: string; displayName: string | null }>): PanelApi {
  return {
    listInboxContacts: vi.fn(async () => ({
      contacts: contacts.map((c) => ({
        ...c,
        createdAt: 1,
        blockedAt: null,
        blockedByDisplayName: null,
        blockedReason: null,
      })),
      nextBefore: null,
    })),
  } as unknown as PanelApi
}

describe('ClientesList (fase 1)', () => {
  afterEach(() => cleanup())

  it('mostra contactos e filtra pela busca', async () => {
    const user = userEvent.setup()
    const api = mockApi([
      { id: 'ctc_marina', waId: '5511999999102', displayName: 'Marina Alves' },
      { id: 'ctc_carla', waId: '5511999993340', displayName: 'Carla Santos' },
    ])

    render(<ClientesList tenantId="clinic-demo-a" api={api} generation={1} />)

    expect(await screen.findByText('Marina Alves')).toBeTruthy()
    expect(screen.getByText('Carla Santos')).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Buscar nome ou telefone' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Bloqueadas' }))
    expect(api.listInboxContacts).toHaveBeenCalledWith(
      'clinic-demo-a',
      expect.objectContaining({ filter: 'blocked' }),
      expect.any(Object),
    )
  })
})
