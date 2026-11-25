// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi, PipelineOpportunity } from '../../api'
import type { InboxRealtimeSignal } from '../../realtime/InboxRealtime'
import { AcompanhamentoBoard } from './AcompanhamentoBoard'

let emitAcompSignal: ((signals: InboxRealtimeSignal[]) => void) | null = null
let lastDebounceMs: number | undefined
vi.mock('../../realtime/InboxRealtime', async (orig) => {
  const mod = await orig<typeof import('../../realtime/InboxRealtime')>()
  return {
    ...mod,
    useInboxRealtime: (cb: (s: InboxRealtimeSignal[]) => void, debounceMs?: number) => {
      emitAcompSignal = cb
      lastDebounceMs = debounceMs
    },
  }
})

afterEach(() => {
  cleanup()
  emitAcompSignal = null
  lastDebounceMs = undefined
})

function card(over: Partial<PipelineOpportunity> = {}): PipelineOpportunity {
  return {
    id: 'opp_1',
    tenantId: 't',
    contactId: 'ct_1',
    conversationId: 'cnv_1',
    stage: 'em_atendimento',
    status: 'open',
    cycleNumber: 1,
    assigneeClerkUserId: null,
    assigneeDisplayName: null,
    lastInteractionAt: Date.now() - 60_000,
    linkedAppointmentId: null,
    createdAt: 1,
    updatedAt: 1,
    contact: { id: 'ct_1', waId: '5511900000000', displayName: 'Ana Silva', createdAt: 1 },
    missingAppointment: false,
    linkedAppointment: null,
    cardKind: 'cycle',
    boardKey: 'opp_1',
    futureAppointmentCount: 0,
    hasOpenAttendance: false,
    ...over,
  }
}

describe('AcompanhamentoBoard (celular) — etapas finais', () => {
  it('pede as oportunidades encerradas só nas abas Concluído e Perdido', async () => {
    const list = vi.fn(async () => ({ opportunities: [], counts: [] }))
    const api = { listPipelineOpportunities: list } as unknown as PanelApi
    render(<AcompanhamentoBoard tenantId="t" api={api} generation={1} />)
    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(list).toHaveBeenLastCalledWith(
      't',
      expect.objectContaining({ stage: 'em_atendimento', includeClosed: false }),
      expect.anything(),
    )
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /Conclu/ }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        't',
        expect.objectContaining({ stage: 'concluido', includeClosed: true }),
        expect.anything(),
      ),
    )
  })

  it('faixa de etapas usa acomp-tabs (pin / fade esquerdo)', async () => {
    const list = vi.fn(async () => ({ opportunities: [], counts: [] }))
    const api = { listPipelineOpportunities: list } as unknown as PanelApi
    const { container } = render(
      <AcompanhamentoBoard tenantId="t" api={api} generation={1} />,
    )
    await waitFor(() => expect(list).toHaveBeenCalled())
    const tabs = container.querySelector('.panel-tabs.acomp-tabs')
    expect(tabs).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /Horário proposto/i })).toBeNull()
  })

  it('mostra «Aguardando Pix» no cartão em Em atendimento', async () => {
    const list = vi.fn(async () => ({
      opportunities: [card({ hasPendingPix: true })],
      counts: [{ stage: 'em_atendimento', count: 1 }],
    }))
    const api = { listPipelineOpportunities: list } as unknown as PanelApi
    render(<AcompanhamentoBoard tenantId="t" api={api} generation={1} />)
    expect(await screen.findByText('Aguardando Pix')).toBeTruthy()
  })
})

describe('AcompanhamentoBoard — cartões ao vivo', () => {
  it('message.created e appointment.confirmed refetch com keep (sem flash) e debounce 400ms', async () => {
    let n = 0
    const list = vi.fn(async () => {
      n += 1
      return {
        opportunities: [
          card({
            lastInteractionAt: n === 1 ? Date.now() - 60_000 : Date.now(),
            assigneeDisplayName: n === 1 ? null : 'IA',
            assigneeClerkUserId: n === 1 ? null : 'system:ai-autodraft',
          }),
        ],
        counts: [{ stage: 'em_atendimento', count: 1 }],
      }
    })
    const api = { listPipelineOpportunities: list } as unknown as PanelApi
    render(<AcompanhamentoBoard tenantId="t" api={api} generation={1} />)
    await screen.findByText('Ana Silva')
    expect(screen.getByText(/Sem responsável/)).toBeTruthy()
    expect(lastDebounceMs).toBe(400)
    expect(list).toHaveBeenCalledTimes(1)

    await act(async () => {
      emitAcompSignal?.([
        {
          kind: 'event',
          event: {
            type: 'event',
            seq: 1,
            eventId: 'e1',
            eventType: 'message.created',
            entity: { type: 'message', id: 'm1' },
            occurredAt: Date.now(),
            payload: { conversationId: 'cnv_1' },
          },
        },
      ])
    })
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    expect(screen.getByText(/IA/)).toBeTruthy()
    // keep:true → cartão continua visível (não volta ao skeleton).
    expect(screen.getByText('Ana Silva')).toBeTruthy()

    await act(async () => {
      emitAcompSignal?.([
        {
          kind: 'event',
          event: {
            type: 'event',
            seq: 2,
            eventId: 'e2',
            eventType: 'appointment.confirmed',
            entity: { type: 'appointment', id: 'apt_1' },
            occurredAt: Date.now(),
            payload: { opportunityId: 'opp_1', conversationId: 'cnv_1' },
          },
        },
      ])
    })
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3))
  })
})
