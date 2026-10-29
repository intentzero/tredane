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
    getAppointment: vi.fn(async () => ({
      id: 'a1',
      status: 'confirmed',
      version: 1,
      serviceName: 'Depilação a laser',
      professionalName: 'Dra. Paula',
      roomResourceName: 'Sala 1',
      contactLabel: 'Laura Pires',
      startsAt: at(9, 0),
      events: [],
    })),
    listAppointmentReasons: vi.fn(async () => []),
    getAppointmentPaidSignal: vi.fn(async () => null),
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

const dayRoute = expect.objectContaining({ kind: 'area', area: 'agenda', section: 'dia' })

describe('Agenda — compromisso em painel por cima no desktop (DEC-069)', () => {
  it('com um compromisso na rota, abre o painel ao lado da grade', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" openId="a1" />)
    const panel = await screen.findByRole('complementary', { name: 'Compromisso' })
    expect(await within(panel).findByText(/Depilação a laser · Dra\. Paula/)).toBeTruthy()
    expect(document.querySelector('.agenda-grid')).toBeTruthy()
    expect(panel.getAttribute('tabindex')).toBe('-1')
  })

  it('× e Esc fecham o painel e voltam à rota do dia', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" openId="a1" />)
    const panel = await screen.findByRole('complementary', { name: 'Compromisso' })
    fireEvent.click(await within(panel).findByRole('button', { name: 'Fechar compromisso' }))
    expect(navigatePanel).toHaveBeenLastCalledWith(dayRoute)
    navigatePanel.mockClear()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(navigatePanel).toHaveBeenLastCalledWith(dayRoute)
  })

  it('tocar de novo no item aberto fecha; noutro item abre esse', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" openId="a1" />)
    const context = await screen.findByRole('complementary', { name: 'Contexto da agenda' })
    await screen.findByRole('complementary', { name: 'Compromisso' })
    fireEvent.click(within(context).getByText('Laura Pires'))
    expect(navigatePanel).toHaveBeenLastCalledWith(dayRoute)
    fireEvent.click(within(context).getByText('Carla Mendes'))
    expect(navigatePanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ section: 'compromisso', appointmentId: 'a2' }),
    )
  })

  it('abaixo de 1280 px não há painel por cima', async () => {
    wideScreen = false
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" openId="a1" />)
    await waitFor(() => expect(document.querySelector('.agenda-grid')).toBeTruthy())
    expect(screen.queryByRole('complementary', { name: 'Compromisso' })).toBeNull()
  })
})
