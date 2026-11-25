// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpportunityStage, PanelApi, PipelineOpportunity } from '../../api'
import type { InboxRealtimeSignal } from '../../realtime/InboxRealtime'
import { AcompanhamentoWideBoard } from './AcompanhamentoWideBoard'

const navigatePanel = vi.fn()
vi.mock('../../routes', async (orig) => ({
  ...(await orig<typeof import('../../routes')>()),
  navigatePanel: (...a: unknown[]) => navigatePanel(...a),
}))

let emitWideSignal: ((signals: InboxRealtimeSignal[]) => void) | null = null
let lastWideDebounceMs: number | undefined
vi.mock('../../realtime/InboxRealtime', async (orig) => {
  const mod = await orig<typeof import('../../realtime/InboxRealtime')>()
  return {
    ...mod,
    useInboxRealtime: (cb: (s: InboxRealtimeSignal[]) => void, debounceMs?: number) => {
      emitWideSignal = cb
      lastWideDebounceMs = debounceMs
    },
  }
})

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
    cardKind: 'cycle',
    boardKey: id,
    futureAppointmentCount: 0,
    hasOpenAttendance: false,
    ...over,
  }
}

const DATA: Record<string, PipelineOpportunity[]> = {
  novo_contato: [card('a', 'Maria Souza', 'novo_contato', { assigneeClerkUserId: null, assigneeDisplayName: null })],
  em_atendimento: [
    card('b', 'Sérgio Teixeira', 'em_atendimento', { hasPendingPix: true }),
    card('c', 'Fernanda Araújo', 'em_atendimento', {
      assigneeClerkUserId: 'user_outra',
      assigneeDisplayName: 'Camila',
      lastInteractionAt: NOW - 3 * DAY,
    }),
  ],
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
  beforeEach(() => {
    navigatePanel.mockReset()
    emitWideSignal = null
    lastWideDebounceMs = undefined
  })
  afterEach(cleanup)

  it('mostra as cinco colunas por etapa com a contagem, incluindo Perdido', async () => {
    mount()
    const board = await screen.findByRole('group', { name: 'Quadro por etapa' })
    const cols = within(board).getAllByRole('region')
    expect(cols.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Novo contato, 1',
      'Em atendimento, 2',
      'Agendado, 1',
      'Concluído, 0',
      'Perdido, 1',
    ])
    expect(screen.getByText('Renata Lopes')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Perdidos' })).toBeNull()
  })

  it('pede ao servidor as oportunidades encerradas só para Concluído e Perdido', async () => {
    const api = makeApi()
    mount(undefined, api)
    await screen.findByText('Renata Lopes')
    const calls = (api.listPipelineOpportunities as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, { stage: string; includeClosed?: boolean }]
    >
    const closedFlag = Object.fromEntries(calls.map(([, q]) => [q.stage, q.includeClosed]))
    expect(closedFlag).toMatchObject({
      novo_contato: false,
      em_atendimento: false,
      agendado: false,
      concluido: true,
      perdido: true,
    })
  })

  it('cartão: avatar com iniciais, ponto de etapa no título; coluna vazia sem «Ninguém aqui»', async () => {
    mount()
    const board = await screen.findByRole('group', { name: 'Quadro por etapa' })
    const maria = within(board).getByRole('button', { name: 'Abrir Maria Souza' })
    expect(maria.querySelector('.inbox-avatar')?.textContent).toBe('MS')
    expect(maria.querySelector('.acomp-card-unassigned')?.textContent).toBe('Sem responsável')
    const dots = Array.from(board.querySelectorAll('.acomp-col-dot')).map((d) => d.getAttribute('data-stage'))
    expect(dots).toEqual(['novo_contato', 'em_atendimento', 'agendado', 'concluido', 'perdido'])
    const empty = within(board).getByRole('region', { name: 'Concluído, 0' })
    expect(within(empty).queryByText('Ninguém aqui')).toBeNull()
    expect(empty.querySelector('.acomp-col-empty')).toBeNull()
    expect(within(empty).getByText('0')).toBeTruthy()
    const sergio = within(board).getByRole('button', { name: 'Abrir Sérgio Teixeira' })
    expect(within(sergio).getByText('Aguardando Pix')).toBeTruthy()
  })

  it('cartão: data da marcação em chip e «IA» em chip (DEC-184)', async () => {
    const previous: PipelineOpportunity[] = [...(DATA.agendado ?? [])]
    DATA.agendado = [
      card('d', 'Carla Mendes', 'agendado', {
        assigneeClerkUserId: 'system:ai-autodraft',
        assigneeDisplayName: 'IA',
        linkedAppointmentId: 'ap1',
        linkedAppointment: { id: 'ap1', startsAt: NOW + DAY, endsAt: NOW + DAY + 3_600_000, status: 'confirmed' } as never,
      }),
    ]
    try {
      mount()
      const carla = await screen.findByRole('button', { name: 'Abrir Carla Mendes' })
      expect(carla.querySelector('.acomp-card-when')).not.toBeNull()
      expect(carla.querySelector('.acomp-chip-ai')?.textContent).toBe('IA')
      // Chip «Parado» / filtro 2 dias saíram com DEC-208 (idle 30 min); cartão antigo só mostra o responsável.
      const fernanda = await screen.findByRole('button', { name: 'Abrir Fernanda Araújo' })
      expect(within(fernanda).queryByText('Parado')).toBeNull()
      expect(within(fernanda).getByText('Camila')).toBeTruthy()
    } finally {
      DATA.agendado = previous
    }
  })

  it('mantém o chip de data e o calendário depois de remarcar', async () => {
    const previous: PipelineOpportunity[] = [...(DATA.agendado ?? [])]
    DATA.agendado = [
      card('d', 'Carla Mendes', 'agendado', {
        linkedAppointmentId: 'ap1',
        linkedAppointment: {
          id: 'ap1',
          startsAt: NOW + DAY,
          endsAt: NOW + DAY + 3_600_000,
          status: 'confirmed',
          changeReason: 'contato_remarcou',
        } as never,
      }),
    ]
    try {
      mount()
      const carla = await screen.findByRole('button', { name: 'Abrir Carla Mendes' })
      const when = carla.querySelector('.acomp-card-when')
      expect(when).not.toBeNull()
      expect(when?.querySelector('svg')).not.toBeNull()
      expect(carla.querySelector('.acomp-card-line')).toBeNull()
    } finally {
      DATA.agendado = previous
    }
  })

  it('«IA» em chip só pelo id do responsável, não pelo texto do nome (DEC-184)', async () => {
    const previous: PipelineOpportunity[] = [...(DATA.agendado ?? [])]
    DATA.agendado = [
      card('d', 'Carla Mendes', 'agendado', { assigneeClerkUserId: 'user_x', assigneeDisplayName: 'IA' }),
    ]
    try {
      mount()
      const carla = await screen.findByRole('button', { name: 'Abrir Carla Mendes' })
      expect(carla.querySelector('.acomp-chip-ai')).toBeNull()
      expect(within(carla).getByText('IA')).toBeTruthy()
    } finally {
      DATA.agendado = previous
    }
  })

  it('filtros: Minhas e Sem responsável (sem «Parados há mais de 2 dias» — DEC-208)', async () => {
    mount()
    const user = userEvent.setup()
    await screen.findByText('Maria Souza')

    expect(screen.queryByRole('button', { name: /^Parados há mais de 2 dias/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: /^Minhas/ }))
    expect(screen.getByText('Sérgio Teixeira')).toBeTruthy()
    expect(screen.queryByText('Fernanda Araújo')).toBeNull()
    expect(screen.queryByText('Maria Souza')).toBeNull()

    await user.click(screen.getByRole('button', { name: /^Sem responsável/ }))
    expect(screen.getByText('Maria Souza')).toBeTruthy()
    expect(screen.queryByText('Sérgio Teixeira')).toBeNull()
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

describe('AcompanhamentoWideBoard — filtro «Profissional» (#254)', () => {
  beforeEach(() => navigatePanel.mockReset())
  afterEach(cleanup)

  const appt = (id: string, professionalId: string) => ({
    id,
    startsAt: NOW + DAY,
    endsAt: NOW + DAY + 3_600_000,
    status: 'confirmed' as const,
    contactLabel: null,
    serviceId: 'svc',
    professionalId,
  })
  const BY_STAGE: Record<string, PipelineOpportunity[]> = {
    novo_contato: [card('a', 'Maria Souza', 'novo_contato')],
    em_atendimento: [card('b', 'Sérgio Teixeira', 'em_atendimento')],
    agendado: [
      card('d', 'Carla Mendes', 'agendado', { linkedAppointment: appt('ap1', 'p_paula') }),
      card('f', 'Ana Beatriz', 'agendado', { linkedAppointment: appt('ap2', 'p_livia') }),
    ],
    concluido: [],
  }
  const api = () =>
    ({
      getMe: async () => ({ clerkUserId: 'user_eu' }),
      listPipelineOpportunities: vi.fn(async (_t: string, q: { stage: string }) => ({
        opportunities: BY_STAGE[q.stage] ?? [],
        counts: [],
      })),
      getClinicConfig: vi.fn(async () => ({
        resources: [
          { id: 'p_paula', kind: 'professional', name: 'Dra. Paula', active: true },
          { id: 'p_livia', kind: 'professional', name: 'Lívia', active: true },
          { id: 'p_off', kind: 'professional', name: 'Inativa', active: false },
          { id: 'r1', kind: 'room', name: 'Sala 1', active: true },
        ],
      })),
    }) as unknown as PanelApi

  it('chips das profissionais ativas com a contagem pelo compromisso ligado', async () => {
    mount(undefined, api())
    const group = await screen.findByRole('group', { name: 'Filtrar por profissional' })
    expect(within(group).getByRole('button', { name: /Dra\. Paula/ }).textContent).toMatch(/1$/)
    expect(within(group).getByRole('button', { name: /Lívia/ })).toBeTruthy()
    expect(within(group).queryByText('Inativa')).toBeNull()
    expect(within(group).queryByText('Sala 1')).toBeNull()
  })

  it('filtra só cartões com compromisso dessa profissional e avisa; «Limpar» volta a tudo', async () => {
    mount(undefined, api())
    const user = userEvent.setup()
    await screen.findByText('Maria Souza')
    await user.click(screen.getByRole('button', { name: /Dra\. Paula/ }))
    expect(screen.getByText('Carla Mendes')).toBeTruthy()
    expect(screen.queryByText('Ana Beatriz')).toBeNull()
    // Sem compromisso, não há profissional: ficam ocultos.
    expect(screen.queryByText('Maria Souza')).toBeNull()
    expect(screen.queryByText('Sérgio Teixeira')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/só quem já tem horário com Dra\. Paula/)

    await user.click(screen.getByRole('button', { name: /Lívia/ }))
    expect(screen.getByText('Ana Beatriz')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/Dra\. Paula e Lívia/)

    await user.click(screen.getByRole('button', { name: 'Limpar' }))
    expect(screen.getByText('Maria Souza')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('combina com os outros filtros (E lógico)', async () => {
    mount(undefined, api())
    const user = userEvent.setup()
    await screen.findByText('Maria Souza')
    await user.click(screen.getByRole('button', { name: /Dra\. Paula/ }))
    await user.click(screen.getByRole('button', { name: /^Sem responsável/ }))
    // Carla tem responsável (user_eu): some com «Sem responsável».
    expect(screen.queryByText('Carla Mendes')).toBeNull()
  })

  it('sem cadastro legível ou com uma só profissional, o quadro segue sem o filtro', async () => {
    const broken = { ...api(), getClinicConfig: vi.fn(async () => { throw new Error('x') }) } as unknown as PanelApi
    mount(undefined, broken)
    await screen.findByText('Maria Souza')
    expect(screen.queryByRole('group', { name: 'Filtrar por profissional' })).toBeNull()
  })
})

describe('AcompanhamentoWideBoard — cartões ao vivo', () => {
  beforeEach(() => {
    emitWideSignal = null
    lastWideDebounceMs = undefined
  })
  afterEach(cleanup)

  it('appointment.rescheduled refetch com keep e debounce 400ms (sem skeleton)', async () => {
    let n = 0
    const list = vi.fn(async (_t: string, q: { stage: string }) => {
      n += 1
      const base = DATA[q.stage] ?? []
      if (q.stage !== 'agendado') return { opportunities: base, counts: [] }
      return {
        opportunities: [
          card('d', 'Carla Mendes', 'agendado', {
            linkedAppointmentId: 'ap1',
            linkedAppointment: {
              id: 'ap1',
              startsAt: n <= 5 ? NOW + DAY : NOW + 2 * DAY,
              endsAt: (n <= 5 ? NOW + DAY : NOW + 2 * DAY) + 3_600_000,
              status: 'confirmed',
            } as never,
          }),
        ],
        counts: [],
      }
    })
    const api = {
      getMe: async () => ({ clerkUserId: 'user_eu' }),
      listPipelineOpportunities: list,
    } as unknown as PanelApi

    mount(undefined, api)
    await screen.findByText('Carla Mendes')
    expect(lastWideDebounceMs).toBe(400)
    const callsBefore = list.mock.calls.length

    await act(async () => {
      emitWideSignal?.([
        {
          kind: 'event',
          event: {
            type: 'event',
            seq: 1,
            eventId: 'e1',
            eventType: 'appointment.rescheduled',
            entity: { type: 'appointment', id: 'ap1' },
            occurredAt: Date.now(),
            payload: { opportunityId: 'd', conversationId: 'cnv_d' },
          },
        },
      ])
    })
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(callsBefore))
    // keep:true → o quadro não volta ao skeleton.
    expect(screen.getByRole('group', { name: 'Quadro por etapa' })).toBeTruthy()
    expect(screen.getByText('Carla Mendes')).toBeTruthy()
  })

  it('Precisa de alguém: chip no cartão, filtro e barra de atenção no quadro', async () => {
    const previous = [...(DATA.agendado ?? [])]
    DATA.agendado = [
      card('p', 'Paulo', 'agendado', {
        assigneeClerkUserId: null,
        assigneeDisplayName: null,
        needsPerson: true,
        hasOpenAttendance: true,
        futureAppointmentCount: 1,
        linkedAppointmentId: 'ap-p',
        linkedAppointment: {
          id: 'ap-p',
          startsAt: NOW + DAY,
          endsAt: NOW + DAY + 3_600_000,
          status: 'confirmed',
        } as never,
      }),
    ]
    DATA.em_atendimento = [
      card('p', 'Paulo', 'em_atendimento', {
        contactId: 'ct_p',
        assigneeClerkUserId: null,
        assigneeDisplayName: null,
        needsPerson: true,
        cardKind: 'open_attendance',
        boardKey: 'p:attendance',
        hasOpenAttendance: true,
        futureAppointmentCount: 1,
      }),
    ]
    try {
      mount()
      const board = await screen.findByRole('group', { name: 'Quadro por etapa' })
      const pauloCards = within(board).getAllByRole('button', {
        name: /Abrir Paulo\. Precisa de alguém/,
      })
      expect(pauloCards).toHaveLength(2)
      for (const el of pauloCards) {
        expect(el.className).toContain('acomp-card--needs-person')
        expect(within(el).getByText('Precisa de alguém')).toBeTruthy()
      }
      expect(
        pauloCards.some((el) => el.getAttribute('data-card-kind') === 'open_attendance'),
      ).toBe(true)
      const needsFilter = screen.getByRole('button', { name: /^Precisa de alguém/ })
      expect(needsFilter.className).toContain('panel-chip--warn')
      expect(within(needsFilter).getByText('2')).toBeTruthy()
    } finally {
      DATA.agendado = previous
      DATA.em_atendimento = [
        card('b', 'Sérgio Teixeira', 'em_atendimento'),
        card('c', 'Fernanda Araújo', 'em_atendimento', {
          assigneeClerkUserId: 'user_outra',
          assigneeDisplayName: 'Camila',
          lastInteractionAt: NOW - 3 * DAY,
        }),
      ]
    }
  })

  it('DEC-187: gémeo de atendimento + badge N no Agendado; total conta contactos distintos', async () => {
    const prevEarly = [...(DATA.em_atendimento ?? [])]
    const prevAg = [...(DATA.agendado ?? [])]
    DATA.em_atendimento = [
      card('d', 'Carla Mendes', 'em_atendimento', {
        contactId: 'ct_d',
        cardKind: 'open_attendance',
        boardKey: 'd:attendance',
        futureAppointmentCount: 2,
        hasOpenAttendance: true,
      }),
    ]
    DATA.agendado = [
      card('d', 'Carla Mendes', 'agendado', {
        contactId: 'ct_d',
        cardKind: 'cycle',
        boardKey: 'd',
        futureAppointmentCount: 2,
        hasOpenAttendance: true,
        linkedAppointmentId: 'ap1',
        linkedAppointment: {
          id: 'ap1',
          startsAt: NOW + DAY,
          endsAt: NOW + DAY + 3_600_000,
          status: 'confirmed',
        } as never,
      }),
    ]
    DATA.novo_contato = []
    try {
      mount()
      await screen.findByText('Atendimento em curso')
      const cols = within(await screen.findByRole('group', { name: 'Quadro por etapa' })).getAllByRole(
        'region',
      )
      expect(cols.map((c) => c.getAttribute('aria-label'))).toEqual([
        'Novo contato, 0',
        'Em atendimento, 1',
        'Agendado, 1',
        'Concluído, 0',
        'Perdido, 1',
      ])
      // Mesmo contacto nas duas colunas → «1 contato em andamento».
      expect(screen.getByText('1 contatos em andamento')).toBeTruthy()
      const agendado = within(
        screen.getByRole('region', { name: 'Agendado, 1' }),
      ).getByRole('button', { name: 'Abrir Carla Mendes' })
      expect(agendado.querySelector('.acomp-apt-count')?.textContent).toBe('2')
    } finally {
      DATA.em_atendimento = prevEarly
      DATA.agendado = prevAg
      DATA.novo_contato = [card('a', 'Maria Souza', 'novo_contato', { assigneeClerkUserId: null, assigneeDisplayName: null })]
    }
  })
})
