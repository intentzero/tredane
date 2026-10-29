// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpportunityStage, PanelApi, PipelineOpportunity } from '../../api'
import { AcompanhamentoWideBoard } from './AcompanhamentoWideBoard'

const navigatePanel = vi.fn()
vi.mock('../../routes', async (orig) => ({
  ...(await orig<typeof import('../../routes')>()),
  navigatePanel: (...a: unknown[]) => navigatePanel(...a),
}))

const DAY = 86_400_000
const NOW = Date.now()

function card(
  id: string,
  name: string,
  stage: OpportunityStage,
  over: Partial<PipelineOpportunity> = {},
): PipelineOpportunity {
  return {
    id,
    tenantId: 't',
    contactId: `ct_${id}`,
    conversationId: `cnv_${id}`,
    stage,
    status: 'open',
    cycleNumber: 1,
    assigneeClerkUserId: 'user_eu',
    assigneeDisplayName: 'Você',
    lastInteractionAt: NOW - 60_000,
    linkedAppointmentId: null,
    createdAt: 1,
    updatedAt: 1,
    contact: { id: `ct_${id}`, waId: '5511900000000', displayName: name, createdAt: 1 },
    missingAppointment: false,
    linkedAppointment: null,
    ...over,
  }
}

const DATA: Record<string, PipelineOpportunity[]> = {
  novo_contato: [card('a', 'Maria Souza', 'novo_contato', { assigneeClerkUserId: null, assigneeDisplayName: null })],
  em_atendimento: [
    card('b', 'Sérgio Teixeira', 'em_atendimento'),
    card('c', 'Fernanda Araújo', 'em_atendimento', {
      assigneeClerkUserId: 'user_outra',
      assigneeDisplayName: 'Camila',
      lastInteractionAt: NOW - 3 * DAY,
    }),
  ],
  horario_proposto: [],
  agendado: [card('d', 'Carla Mendes', 'agendado')],
  concluido: [],
  perdido: [card('e', 'Renata Lopes', 'perdido')],
}

function makeApi(): PanelApi {
  return {
    getMe: async () => ({ clerkUserId: 'user_eu' }),
    listPipelineOpportunities: vi.fn(async (_t: string, q: { stage: string }) => ({
      opportunities: DATA[q.stage] ?? [],
      counts: [],
    })),
  } as unknown as PanelApi
}

function mount(openId?: string, api = makeApi()) {
  return render(<AcompanhamentoWideBoard tenantId="t" api={api} generation={1} openId={openId} />)
}

describe('AcompanhamentoWideBoard (quadro em largura total)', () => {
  beforeEach(() => navigatePanel.mockReset())
  afterEach(cleanup)

  it('mostra uma coluna por etapa com a contagem; «Perdido» fica de fora', async () => {
    mount()
    const board = await screen.findByRole('group', { name: 'Quadro por etapa' })
    const cols = within(board).getAllByRole('region')
    expect(cols.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Novo contato, 1',
      'Em atendimento, 2',
      'Horário proposto, 0',
      'Agendado, 1',
      'Concluído, 0',
    ])
    expect(screen.queryByText('Renata Lopes')).toBeNull()
  })

  it('«Perdidos» acrescenta a coluna Perdido', async () => {
    mount()
    const user = userEvent.setup()
    await screen.findByText('Maria Souza')
    await user.click(screen.getByRole('button', { name: 'Perdidos' }))
    expect(await screen.findByText('Renata Lopes')).toBeTruthy()
  })

  it('filtros: Minhas, Sem responsável e Parados há mais de 2 dias', async () => {
    mount()
    const user = userEvent.setup()
    await screen.findByText('Maria Souza')

    await user.click(screen.getByRole('button', { name: /^Minhas/ }))
    expect(screen.getByText('Sérgio Teixeira')).toBeTruthy()
    expect(screen.queryByText('Fernanda Araújo')).toBeNull()
    expect(screen.queryByText('Maria Souza')).toBeNull()

    await user.click(screen.getByRole('button', { name: /^Sem responsável/ }))
    expect(screen.getByText('Maria Souza')).toBeTruthy()
    expect(screen.queryByText('Sérgio Teixeira')).toBeNull()

    await user.click(screen.getByRole('button', { name: /^Parados há mais de 2 dias/ }))
    expect(screen.getByText('Fernanda Araújo')).toBeTruthy()
    expect(screen.queryByText('Sérgio Teixeira')).toBeNull()
    // Agendado não conta como parado.
    expect(screen.queryByText('Carla Mendes')).toBeNull()
  })

  it('a busca filtra pelo nome', async () => {
    mount()
    const user = userEvent.setup()
    await screen.findByText('Maria Souza')
    await user.type(screen.getByRole('searchbox', { name: 'Buscar contato' }), 'carla')
    expect(screen.getByText('Carla Mendes')).toBeTruthy()
    expect(screen.queryByText('Maria Souza')).toBeNull()
  })

  it('tocar num cartão abre o contato (rota de detalhe); tocar no aberto fecha', async () => {
    const user = userEvent.setup()
    const { rerender } = mount()
    await user.click(await screen.findByRole('button', { name: 'Abrir Sérgio Teixeira' }))
    expect(navigatePanel).toHaveBeenCalledWith(
      expect.objectContaining({ section: 'detalhe', opportunityId: 'b' }),
    )
    navigatePanel.mockReset()
    rerender(<AcompanhamentoWideBoard tenantId="t" api={makeApi()} generation={1} openId="b" />)
    const open = await screen.findByRole('button', { name: 'Abrir Sérgio Teixeira' })
    expect(open.getAttribute('aria-expanded')).toBe('true')
    await user.click(open)
    expect(navigatePanel).toHaveBeenCalledWith(expect.objectContaining({ section: 'quadro' }))
  })

  it('o painel do contato aparece por cima quando há um contato aberto', async () => {
    const api = {
      ...makeApi(),
      getPipelineOpportunity: vi.fn(() => new Promise(() => undefined)),
    } as unknown as PanelApi
    const { container } = mount('b', api)
    await waitFor(() => expect(container.querySelector('#acomp-panel')).toBeTruthy())
    expect(container.querySelector('.acomp-wide')?.getAttribute('data-panel')).toBe('open')
  })
})
