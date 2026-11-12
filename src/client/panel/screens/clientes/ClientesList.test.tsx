import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import { ClientesList, visitLine } from './ClientesList'

const TZ_SP = 'America/Sao_Paulo'
const TZ_MANAUS = 'America/Manaus'

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

  it('carrega o fuso da clínica activa ao abrir Clientes', async () => {
    const getClinicConfig = vi.fn(async () => ({
      settings: { timezone: TZ_MANAUS },
    }))
    const api = {
      ...mockApi([{ id: 'ctc_a', waId: '5511999990001', displayName: 'Ana' }]),
      getClinicConfig,
    } as unknown as PanelApi

    render(<ClientesList tenantId="clinic-manaus" api={api} generation={2} />)

    expect(await screen.findByText('Ana')).toBeTruthy()
    expect(getClinicConfig).toHaveBeenCalledWith(
      'clinic-manaus',
      expect.objectContaining({ generation: 2 }),
    )
  })
})

describe('visitLine (DEC-165)', () => {
  const base = { id: 'k', waId: '5511999990000', displayName: 'Fictícia', createdAt: 0 }

  it('prefere o próximo horário, depois a última visita, senão «Sem horários»', () => {
    const next = visitLine(
      {
        ...base,
        nextVisit: { startsAt: Date.UTC(2026, 10, 13, 12, 30), serviceName: 'Limpeza' },
        lastVisit: { startsAt: Date.UTC(2026, 9, 27, 12), serviceName: 'Peeling' },
      },
      TZ_SP,
    )
    expect(next.next).toBe(true)
    expect(next.text).toMatch(/^Próximo: .+ · Limpeza$/)
    const last = visitLine(
      {
        ...base,
        nextVisit: null,
        lastVisit: { startsAt: Date.UTC(2026, 9, 27, 12), serviceName: 'Peeling' },
      },
      TZ_SP,
    )
    expect(last).toEqual({ text: 'Última visita 27/10 · Peeling', next: false })
    expect(visitLine({ ...base, nextVisit: null, lastVisit: null }, TZ_SP).text).toBe(
      'Sem horários',
    )
  })

  it('formata nextVisit no fuso passado, não no global implícito', () => {
    // 12:30 UTC → 09:30 em São Paulo (UTC−3), 08:30 em Manaus (UTC−4).
    const startsAt = Date.UTC(2026, 10, 13, 12, 30)
    const contact = {
      ...base,
      nextVisit: { startsAt, serviceName: 'Limpeza' },
      lastVisit: null,
    }
    expect(visitLine(contact, TZ_SP).text).toContain('09:30')
    expect(visitLine(contact, TZ_MANAUS).text).toContain('08:30')
  })
})
