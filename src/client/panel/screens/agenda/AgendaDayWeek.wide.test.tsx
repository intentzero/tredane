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
  it('mostra mês e filtros ao lado da grade, sem repetir a lista do dia; Agendar fica na barra (DEC-170)', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" />)
    const context = await screen.findByRole('complementary', { name: 'Contexto da agenda' })
    expect(within(context).queryByRole('button', { name: 'Agendar' })).toBeNull()
    const nav = screen.getByRole('group', { name: 'Navegação de data' })
    expect(within(nav).getByRole('button', { name: 'Hoje' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: /^Quarta, 28 de outubro/ })).toBeTruthy()
    expect(within(context).getByRole('group', { name: 'Escolher o dia' })).toBeTruthy()
    expect(within(context).getByRole('group', { name: 'Filtrar por profissional' })).toBeTruthy()
    expect(within(context).getByRole('group', { name: 'Filtrar por sala' })).toBeTruthy()
    expect(within(context).queryByText(/Laura Pires/)).toBeNull()
    expect(within(document.querySelector('.agenda-grid') as HTMLElement).getByText(/Laura Pires/)).toBeTruthy()
    expect(document.querySelector('.agenda-weekstrip')).toBeNull()
  })

  it('o dia marcado no mês é o da grade e escolher outro pede a agenda desse dia', async () => {
    const api = mockApi()
    render(<AgendaDayWeek tenantId="t" api={api} generation={1} view="day" />)
    const context = await screen.findByRole('complementary', { name: 'Contexto da agenda' })
    // A agenda e o cadastro chegam em chamadas separadas: espera as duas antes de mexer no mês,
    // senão a segunda resposta pode redesenhar a coluna depois do clique (teste instável no CI).
    await screen.findByText(/Laura Pires/)
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

  it('filtro por sala vale para a grade; «Limpar filtros» volta a tudo', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" />)
    const context = await screen.findByRole('complementary', { name: 'Contexto da agenda' })
    fireEvent.click(within(context).getByRole('button', { name: 'Sala 1' }))
    const grid = document.querySelector('.agenda-grid') as HTMLElement
    expect(within(grid).queryByText(/Carla Mendes/)).toBeNull()
    expect(within(grid).getByText(/Laura Pires/)).toBeTruthy()
    // DEC-165: o bloco começa pela cliente; o serviço vem na segunda linha (com a sala).
    expect(within(grid).queryByText(/Drenagem/)).toBeNull()
    expect(within(grid).getByText(/Depilação a laser/)).toBeTruthy()
    fireEvent.click(within(context).getByRole('button', { name: 'Limpar filtros' }))
    expect(await within(grid).findByText(/Carla Mendes/)).toBeTruthy()
  })

  it('«Agendar» da barra leva o dia que está a ver', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" />)
    await screen.findByRole('complementary', { name: 'Contexto da agenda' })
    fireEvent.click(screen.getByRole('button', { name: 'Agendar' }))
    await waitFor(() =>
      expect(navigatePanel).toHaveBeenCalledWith(
        expect.objectContaining({ section: 'agendar', date: '2026-10-28' }),
      ),
    )
  })

  it('dia sem horários não mostra a faixa «Nenhum horário…» nem «Agendar horário»', async () => {
    const api = mockApi()
    ;(api.queryAgenda as ReturnType<typeof vi.fn>).mockResolvedValue({
      tenantId: 't',
      timezone: TZ,
      view: 'week',
      date: '2026-10-28',
      rangeStartsAt: Date.UTC(2026, 9, 26, 3),
      rangeEndsAt: Date.UTC(2026, 10, 2, 3),
      asOf: FIXED_NOW,
      appointments: [],
      holds: [],
    })
    render(<AgendaDayWeek tenantId="t" api={api} generation={1} view="day" />)
    await screen.findByRole('complementary', { name: 'Contexto da agenda' })
    expect(screen.getByRole('button', { name: 'Agendar' })).toBeTruthy()
    expect(document.querySelector('.agenda-empty')).toBeNull()
    expect(screen.queryByText(/Nenhum horário marcado/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Agendar horário' })).toBeNull()
    expect(document.querySelector('.agenda-grid')).toBeTruthy()
  })

  it('o mês marca o dia com um ponto, igual para uma ou várias, e o filtro tira o que não entra', async () => {
    const atDay = (day: number, h: number) => Date.UTC(2026, 9, day, h + 3, 0)
    const one = (id: string, day: number, h: number, pro: string, room: string | null, status: 'confirmed' | 'cancelled' = 'confirmed') => ({
      ...apt(id, id, 'Massagem', 9, 0, 30, pro, room),
      startsAt: atDay(day, h),
      endsAt: atDay(day, h) + 30 * 60_000,
      occupiesUntil: atDay(day, h) + 30 * 60_000,
      status,
    })
    const api = mockApi()
    ;(api.queryAgenda as ReturnType<typeof vi.fn>).mockImplementation(async (_t: string, query: { view?: string }) => {
      if (query.view === 'month') {
        return {
          tenantId: 't',
          timezone: TZ,
          view: 'month',
          date: '2026-10-01',
          rangeStartsAt: Date.UTC(2026, 9, 1, 3),
          rangeEndsAt: Date.UTC(2026, 10, 1, 3),
          asOf: FIXED_NOW,
          appointments: [
            one('m1', 4, 9, 'p_paula', 'r_1'),
            one('m2', 11, 9, 'p_bruna', 'r_bem'),
            one('m3', 11, 11, 'p_livia', 'r_bem'),
            one('m4', 11, 14, 'p_paula', 'r_bem'),
            one('m5', 18, 9, 'p_paula', 'r_1', 'cancelled'),
            one('m6', 28, 10, 'p_paula', 'r_1'),
          ],
          holds: [
            {
              id: 'h1',
              status: 'active',
              opportunityId: null,
              conversationId: 'c1',
              contactId: 'ct',
              contactName: 'Ana',
              serviceId: 'svc',
              serviceName: 'Massagem',
              professionalId: 'p_paula',
              professionalName: 'Dra. Paula',
              durationMinutes: 60,
              windowStartsAt: atDay(20, 9),
              windowEndsAt: atDay(20, 12),
              confirmBy: null,
              appointmentId: null,
              responsibleClerkUserId: null,
              responsibleDisplayName: null,
              createdAt: atDay(20, 9),
              updatedAt: atDay(20, 9),
              resolvedAt: null,
              expiredAt: null,
              cancelledAt: null,
              alertDismissedAt: null,
            },
          ],
        }
      }
      return {
        tenantId: 't',
        timezone: TZ,
        view: 'week',
        date: '2026-10-28',
        rangeStartsAt: Date.UTC(2026, 9, 26, 3),
        rangeEndsAt: Date.UTC(2026, 10, 2, 3),
        asOf: FIXED_NOW,
        appointments: [apt('a1', 'Laura Pires', 'Depilação a laser', 9, 0, 30, 'p_paula', 'r_1')],
        holds: [],
      }
    })
    render(<AgendaDayWeek tenantId="t" api={api} generation={1} view="day" />)
    const context = await screen.findByRole('complementary', { name: 'Contexto da agenda' })
    const day = async (fragment: RegExp) => within(context).findByRole('button', { name: fragment })
    const dot = (button: HTMLElement) => button.querySelectorAll('.agenda-month-dot')

    const d4 = await day(/, 4 de outubro, 1 marcação/)
    const d11 = await day(/, 11 de outubro, 3 marcações/)
    expect(dot(d4)).toHaveLength(1)
    expect(dot(d11)).toHaveLength(1)
    expect(dot(d4)[0]?.getAttribute('aria-hidden')).toBe('true')

    const d18 = await day(/, 18 de outubro, sem marcações/)
    expect(dot(d18)).toHaveLength(0)

    const selected = await day(/, 28 de outubro, 1 marcação/)
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(dot(selected)).toHaveLength(1)

    const held = await day(/, 20 de outubro, 1 marcação/)
    expect(dot(held)).toHaveLength(1)

    fireEvent.click(within(context).getByRole('button', { name: 'Sala 1' }))
    expect(dot(await day(/, 4 de outubro, 1 marcação/))).toHaveLength(1)
    expect(dot(await day(/, 11 de outubro, sem marcações/))).toHaveLength(0)
    expect(dot(await day(/, 20 de outubro, sem marcações/))).toHaveLength(0)
  })

  it('abaixo de 1280 px não há coluna de contexto', async () => {
    wideScreen = false
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" />)
    await waitFor(() => expect(document.querySelector('.agenda-grid')).toBeTruthy())
    expect(screen.queryByRole('complementary', { name: 'Contexto da agenda' })).toBeNull()
  })
})
