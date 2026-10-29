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

let wideScreen = true

beforeEach(() => {
  wideScreen = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW)
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: wideScreen && q.includes('min-width: 1280'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})

afterEach(() => {
  cleanup()
  navigatePanel.mockClear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Agenda — coluna de contexto no desktop (DEC-068)', () => {
  it('mostra Agendar, mês, filtros e a lista do dia ao lado da grade', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" />)
    const context = await screen.findByRole('complementary', { name: 'Contexto da agenda' })
    expect(within(context).getByRole('button', { name: 'Agendar' })).toBeTruthy()
    expect(within(context).getByRole('group', { name: 'Escolher o dia' })).toBeTruthy()
    expect(within(context).getByRole('group', { name: 'Filtrar por profissional' })).toBeTruthy()
    expect(within(context).getByRole('group', { name: 'Filtrar por sala' })).toBeTruthy()
    expect(within(context).getByText('Laura Pires')).toBeTruthy()
    expect(document.querySelector('.agenda-grid')).toBeTruthy()
    expect(document.querySelector('.agenda-weekstrip')).toBeNull()
  })

  it('o dia marcado no mês é o da grade e escolher outro pede a agenda desse dia', async () => {
    const api = mockApi()
    render(<AgendaDayWeek tenantId="t" api={api} generation={1} view="day" />)
    const context = await screen.findByRole('complementary', { name: 'Contexto da agenda' })
    // A agenda e o cadastro chegam em chamadas separadas: espera as duas antes de mexer no mês,
    // senão a segunda resposta pode redesenhar a coluna depois do clique (teste instável no CI).
    await within(context).findByText('Laura Pires')
    await within(within(context).getByRole('group', { name: 'Filtrar por profissional' })).findByRole('button', { name: /Dra\. Paula/ })
    const today = within(context).getByRole('button', { name: /, 28 de outubro/ })
    expect(today.getAttribute('aria-pressed')).toBe('true')
    expect(today.getAttribute('aria-current')).toBe('date')
    fireEvent.click(within(context).getByRole('button', { name: 'Próximo mês' }))
    fireEvent.click(await within(context).findByRole('button', { name: /, 3 de novembro/ }))
    await waitFor(() =>
      expect(api.queryAgenda).toHaveBeenLastCalledWith(
        't',
        expect.objectContaining({ date: '2026-11-03' }),
        expect.anything(),
      ),
    )
  })

  it('filtro por sala vale para a lista do dia e para a grade; «Limpar filtros» volta a tudo', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" />)
    const context = await screen.findByRole('complementary', { name: 'Contexto da agenda' })
    fireEvent.click(within(context).getByRole('button', { name: 'Sala 1' }))
    expect(within(context).queryByText('Carla Mendes')).toBeNull()
    expect(within(context).getByText('Laura Pires')).toBeTruthy()
    const grid = document.querySelector('.agenda-grid') as HTMLElement
    expect(within(grid).queryByText('Drenagem')).toBeNull()
    expect(within(grid).getByText('Depilação a laser')).toBeTruthy()
    fireEvent.click(within(context).getByRole('button', { name: 'Limpar filtros' }))
    expect(await within(context).findByText('Carla Mendes')).toBeTruthy()
  })

  it('«Agendar» da coluna leva o dia que está a ver', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" />)
    const context = await screen.findByRole('complementary', { name: 'Contexto da agenda' })
    fireEvent.click(within(context).getByRole('button', { name: 'Agendar' }))
    await waitFor(() =>
      expect(navigatePanel).toHaveBeenCalledWith(
        expect.objectContaining({ section: 'agendar', date: '2026-10-28' }),
      ),
    )
  })

  it('abaixo de 1280 px não há coluna de contexto', async () => {
    wideScreen = false
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" />)
    await waitFor(() => expect(document.querySelector('.agenda-grid')).toBeTruthy())
    expect(screen.queryByRole('complementary', { name: 'Contexto da agenda' })).toBeNull()
  })
})
