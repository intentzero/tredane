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

describe('visitLine (DEC-165)', () => {
  const base = { id: 'k', waId: '5511999990000', displayName: 'Fictícia', createdAt: 0 }
  it('prefere o próximo horário, depois a última visita, senão «Sem horários»', async () => {
    const { visitLine } = await import('./ClientesList')
    const next = visitLine({
      ...base,
      nextVisit: { startsAt: Date.UTC(2026, 10, 13, 12, 30), serviceName: 'Limpeza' },
      lastVisit: { startsAt: Date.UTC(2026, 9, 27, 12), serviceName: 'Peeling' },
    })
    expect(next.next).toBe(true)
    expect(next.text).toMatch(/^Próximo: .+ · Limpeza$/)
    const last = visitLine({
      ...base,
      nextVisit: null,
      lastVisit: { startsAt: Date.UTC(2026, 9, 27, 12), serviceName: 'Peeling' },
    })
    expect(last).toEqual({ text: 'Última visita 27/10 · Peeling', next: false })
    expect(visitLine({ ...base, nextVisit: null, lastVisit: null }).text).toBe('Sem horários')
  })
})
