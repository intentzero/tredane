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

function day(date: string, open: number, busy: number, free: Array<[number, number]>) {
  return {
    date,
    openMinutes: open,
    busyMinutes: busy,
    windows: [],
    free: free.map(([a, b]) => ({ startsAt: at(a), endsAt: at(b) })),
    blocks: [],
  }
}

function mockApi(appointments: unknown[] = []): PanelApi {
  return {
    queryAgenda: vi.fn(async () => ({
      tenantId: 't',
      timezone: TZ,
      view: 'week',
      date: '2026-10-28',
      rangeStartsAt: Date.UTC(2026, 9, 26, 3),
      rangeEndsAt: Date.UTC(2026, 10, 2, 3),
      asOf: FIXED_NOW,
      appointments,
      holds: [],
      availability: [
        {
          professionalId: 'p_paula',
          professionalName: 'Dra. Paula',
          days: [
            day('2026-10-28', 480, 120, [[10, 11], [13, 14], [15, 16], [16, 17]]),
            day('2026-10-29', 0, 0, []),
          ],
        },
      ],
    })),
    getClinicConfig: vi.fn(async () => ({
      resources: [{ id: 'p_paula', kind: 'professional', name: 'Dra. Paula', active: true }],
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

describe('Agenda — livres e ocupação do expediente', () => {
  it('semana: «N livres» no cabeçalho do dia e barra de ocupação por profissional', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="week" />)
    expect(await screen.findByText(/4 livres/)).toBeTruthy()
    const bar = screen.getByRole('img', { name: 'Paula: 25% do expediente ocupado' })
    expect(bar).toBeTruthy()
    // Dia com expediente fechado não ganha barra.
    expect(screen.getAllByRole('img', { name: /do expediente ocupado/ })).toHaveLength(1)
  })

  it('dia sem horários mostra os três primeiros livres e «Agendar» leva dia, hora e profissional', async () => {
    render(<AgendaDayWeek tenantId="t" api={mockApi()} generation={1} view="day" />)
    const list = await screen.findByRole('list', { name: 'Horários do dia' })
    expect(within(list).getAllByRole('button', { name: /^Agendar \d\d:\d\d, / })).toHaveLength(3)
    fireEvent.click(within(list).getByRole('button', { name: 'Agendar 13:00, Dra. Paula' }))
    await waitFor(() =>
      expect(navigatePanel).toHaveBeenCalledWith(
        expect.objectContaining({
          section: 'agendar',
          date: '2026-10-28',
          time: '13:00',
          professionalId: 'p_paula',
        }),
      ),
    )
  })
})
