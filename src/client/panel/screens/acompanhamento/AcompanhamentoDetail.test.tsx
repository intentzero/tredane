// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi, PipelineOpportunityDetail } from '../../api'
import type { InboxRealtimeSignal } from '../../realtime/InboxRealtime'

const navigatePanel = vi.fn()
vi.mock('../../routes', () => ({
  navigatePanel: (...a: unknown[]) => navigatePanel(...a),
}))
vi.mock('../../clinicTimezone', () => ({
  useClinicTimezone: () => 'America/Sao_Paulo',
  getClinicTimezone: () => 'America/Sao_Paulo',
}))

let emitDetailSignal: ((signals: InboxRealtimeSignal[]) => void) | null = null
let lastDetailDebounceMs: number | undefined
vi.mock('../../realtime/InboxRealtime', async (orig) => {
  const mod = await orig<typeof import('../../realtime/InboxRealtime')>()
  return {
    ...mod,
    useInboxRealtime: (cb: (s: InboxRealtimeSignal[]) => void, debounceMs?: number) => {
      emitDetailSignal = cb
      lastDetailDebounceMs = debounceMs
    },
  }
})

import { AcompanhamentoDetail } from './AcompanhamentoDetail'

afterEach(() => {
  cleanup()
  navigatePanel.mockClear()
  emitDetailSignal = null
  lastDetailDebounceMs = undefined
})

const TZ = 'America/Sao_Paulo'
/** seg. 02/11/2026 15:00 America/Sao_Paulo */
const NOV_2_15 = Date.UTC(2026, 10, 2, 18, 0, 0)
/** sex. 30/10/2026 15:00 America/Sao_Paulo */
const OCT_30_15 = Date.UTC(2026, 9, 30, 18, 0, 0)

function detail(overrides: Partial<PipelineOpportunityDetail> = {}): PipelineOpportunityDetail {
  return {
    id: 'opp_1',
    tenantId: 't',
    contactId: 'ct_1',
    conversationId: 'cnv_1',
    stage: 'agendado',
    status: 'open',
    assigneeClerkUserId: null,
    assigneeDisplayName: null,
    lastInteractionAt: Date.now(),
    cycleNumber: 1,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    contact: {
      id: 'ct_1',
      waId: '5511999999999',
      displayName: 'Paulo',
      createdAt: Date.now(),
    },
    linkedAppointmentId: 'apt_future',
    linkedAppointment: {
      id: 'apt_future',
      startsAt: NOV_2_15,
      endsAt: NOV_2_15 + 30 * 60_000,
      status: 'confirmed',
      contactLabel: 'Paulo',
      serviceId: 'svc_1',
      professionalId: 'p_1',
    },
    missingAppointment: false,
    history: [],
    ...overrides,
  }
}

function mockApi(opp: PipelineOpportunityDetail): PanelApi {
  return {
    getPipelineOpportunity: vi.fn(async () => ({ opportunity: opp })),
  } as unknown as PanelApi
}

describe('AcompanhamentoDetail — Ver na agenda', () => {
  it('abre o compromisso no dia civil do vínculo (≠ hoje)', async () => {
    render(
      <AcompanhamentoDetail
        tenantId="t"
        opportunityId="opp_1"
        api={mockApi(detail())}
        generation={1}
      />,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Ver na agenda' }))
    expect(navigatePanel).toHaveBeenCalledWith({
      kind: 'area',
      area: 'agenda',
      tenantId: 't',
      section: 'compromisso',
      appointmentId: 'apt_future',
      date: '2026-11-02',
    })
  })

  it('abre o compromisso no dia de hoje quando o vínculo é hoje', async () => {
    render(
      <AcompanhamentoDetail
        tenantId="t"
        opportunityId="opp_1"
        api={mockApi(
          detail({
            linkedAppointmentId: 'apt_today',
            linkedAppointment: {
              id: 'apt_today',
              startsAt: OCT_30_15,
              endsAt: OCT_30_15 + 30 * 60_000,
              status: 'confirmed',
              contactLabel: 'Paulo',
              serviceId: 'svc_1',
              professionalId: 'p_1',
            },
          }),
        )}
        generation={1}
      />,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Ver na agenda' }))
    expect(navigatePanel).toHaveBeenCalledWith(
      expect.objectContaining({
        section: 'compromisso',
        appointmentId: 'apt_today',
        date: '2026-10-30',
      }),
    )
  })

  it('sem compromisso vinculado oferece Agendar, não Ver na agenda', async () => {
    render(
      <AcompanhamentoDetail
        tenantId="t"
        opportunityId="opp_1"
        api={mockApi(
          detail({
            linkedAppointmentId: null,
            linkedAppointment: null,
            missingAppointment: true,
          }),
        )}
        generation={1}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agendar horário' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Ver na agenda' })).toBeNull()
    expect(TZ).toBe('America/Sao_Paulo')
  })
})

describe('AcompanhamentoDetail — ao vivo', () => {
  it('conversation.assigned refetch com keep e debounce 400ms', async () => {
    let n = 0
    const get = vi.fn(async () => {
      n += 1
      return {
        opportunity: detail({
          assigneeDisplayName: n === 1 ? null : 'Camila',
          assigneeClerkUserId: n === 1 ? null : 'user_camila',
        }),
      }
    })
    const api = { getPipelineOpportunity: get } as unknown as PanelApi
    render(
      <AcompanhamentoDetail tenantId="t" opportunityId="opp_1" api={api} generation={1} />,
    )
    await screen.findByText('Sem responsável')
    expect(lastDetailDebounceMs).toBe(400)

    await act(async () => {
      emitDetailSignal?.([
        {
          kind: 'event',
          event: {
            type: 'event',
            seq: 1,
            eventId: 'e1',
            eventType: 'conversation.assigned',
            entity: { type: 'conversation', id: 'cnv_1' },
            occurredAt: Date.now(),
            payload: { conversationId: 'cnv_1' },
          },
        },
      ])
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Camila')).toBeTruthy()
    // keep:true → não mostra o loading de abertura de novo.
    expect(screen.queryByText('Abrindo contato em andamento…')).toBeNull()
  })
})
