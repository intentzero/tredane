// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'

const navigatePanel = vi.fn()
vi.mock('../../routes', () => ({ navigatePanel: (...a: unknown[]) => navigatePanel(...a) }))

import { AgendaDayWeek } from './AgendaDayWeek'

const TZ = 'America/Sao_Paulo'
const FIXED_NOW = Date.UTC(2026, 9, 28, 13, 0, 0) // 28/10/2026 10:00 em São Paulo
const at = (h: number, m = 0) => Date.UTC(2026, 9, 28, h + 3, m)

function apt(id: string, name: string, svc: string, h: number, m: number, dur: number, pro: string, room: string | null) {
  return {
    id,
    serviceId: 'svc',
    serviceName: svc,
    professionalId: pro,
    professionalName: pro === 'p_paula' ? 'Dra. Paula' : pro === 'p_livia' ? 'Lívia' : 'Bruna',
    roomResourceId: room,
    roomResourceName: room === 'r_bem' ? 'Sala Bem-estar' : room === 'r_1' ? 'Sala 1' : null,
    startsAt: at(h, m),
    endsAt: at(h, m) + dur * 60_000,
    occupiesUntil: at(h, m) + dur * 60_000,
    status: 'confirmed' as const,
    contactLabel: name,
    contactId: null,
    conversationId: null,
    opportunityId: null,
    version: 1,
    changeReason: null,
  }
}

function mockApi(): PanelApi {
  return {
    queryAgenda: vi.fn(async () => ({
      tenantId: 't',
      timezone: TZ,
      view: 'week',
      date: '2026-10-28',
      rangeStartsAt: Date.UTC(2026, 9, 26, 3),
      rangeEndsAt: Date.UTC(2026, 10, 2, 3),
      asOf: FIXED_NOW,
      appointments: [
        apt('a1', 'Laura Pires', 'Depilação a laser', 9, 0, 30, 'p_paula', 'r_1'),
        apt('a2', 'Carla Mendes', 'Drenagem', 10, 0, 60, 'p_bruna', 'r_bem'),
        apt('a3', 'Marina Alves', 'Massagem', 10, 15, 60, 'p_livia', 'r_bem'),
      ],
      holds: [],
    })),
    getClinicConfig: vi.fn(async () => ({
      resources: [
        { id: 'p_paula', kind: 'professional', name: 'Dra. Paula', active: true },
        { id: 'p_bruna', kind: 'professional', name: 'Bruna', active: true },
        { id: 'p_livia', kind: 'professional', name: 'Lívia', active: true },
        { id: 'r_1', kind: 'room', name: 'Sala 1', active: true, capacity: 1 },
        { id: 'r_bem', kind: 'room', name: 'Sala Bem-estar', active: true, capacity: 3 },
      ],
    })),
  } as unknown as PanelApi
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW)
  vi.stubGlobal(
    'matchMedia',
    (q: string) => ({ matches: q.includes('max-width: 767'), media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  )
})

afterEach(() => {
  cleanup()
  navigatePanel.mockClear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Agenda — dia no celular', () => {
  it('lista cronológica: sala de 1 lugar solta; sala compartilhada com as pessoas e «2/3»', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" />)
    expect(await screen.findByText('Laura Pires')).toBeTruthy()
    const room = screen.getByRole('region', { name: /Sala Bem-estar.*2 de 3 lugares/ })
    expect(within(room).getByText('Carla Mendes')).toBeTruthy()
    expect(within(room).getByText('Marina Alves')).toBeTruthy()
    expect(within(room).getByText('1 lugar livre')).toBeTruthy()
  })

  it('filtro por quem atende: seleção múltipla, resumo e «Ver todos»', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" />)
    await screen.findByText('Laura Pires')
    expect(screen.getByRole('status', { name: '' }).textContent).toMatch(/Todos os 3 profissionais/)
    fireEvent.click(screen.getByRole('button', { name: /Dra\. Paula, 1 horário/ }))
    expect(screen.queryByText('Carla Mendes')).toBeNull()
    expect(screen.getByText('Laura Pires')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Lívia, 1 horário/ }))
    expect(screen.getByText('Marina Alves')).toBeTruthy()
    expect(document.body.textContent).toMatch(/Paula e Lívia/)
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos' }))
    expect(await screen.findByText('Carla Mendes')).toBeTruthy()
  })

  it('«Agendar» leva o dia que está a ver', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" />)
    await screen.findByText('Laura Pires')
    fireEvent.click(screen.getByRole('button', { name: 'Agendar qua 28' }))
    await waitFor(() =>
      expect(navigatePanel).toHaveBeenCalledWith(
        expect.objectContaining({ section: 'agendar', date: '2026-10-28' }),
      ),
    )
  })
})
