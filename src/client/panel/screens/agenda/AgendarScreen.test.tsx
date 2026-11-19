// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'

const navigatePanel = vi.fn()
vi.mock('../../routes', () => ({ navigatePanel: (...a: unknown[]) => navigatePanel(...a) }))

import { AgendarScreen } from './AgendarScreen'

const TZ = 'America/Sao_Paulo'

function at(date: string, hour: number, minute = 0): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!, hour + 3, minute)
}

function slot(date: string, hour: number, minute = 0) {
  const startsAt = at(date, hour, minute)
  return {
    startsAt,
    endsAt: startsAt + 45 * 60_000,
    occupiesUntil: startsAt + 45 * 60_000,
    professionalId: 'pro_ana',
    professionalName: 'Dra. Ana',
    roomResourceId: 'room_1',
    roomResourceName: 'Sala 1',
  }
}

const service = (over: Record<string, unknown> = {}) => ({
  id: 'svc_limpeza',
  name: 'Limpeza',
  durationMinutes: 45,
  bufferMinutes: 0,
  occupiedMinutes: 45,
  priceCents: 18000,
  active: true,
  professionalIds: [],
  requiresSignal: false,
  signalKind: null,
  signalFixedCents: null,
  signalPercent: null,
  ...over,
})

function makeApi(opts: { emptyFirstDay?: boolean; service?: Record<string, unknown>; windowOpen?: boolean } = {}) {
  const firstDay = { value: '' }
  const api = {
    getClinicConfig: vi.fn(async () => ({
      settings: { tenantId: 't1', timezone: TZ, updatedAt: 0 },
      services: [service(opts.service), service({ id: 'svc_av', name: 'Avaliação', durationMinutes: 30, priceCents: 12000 })],
      resources: [
        { id: 'pro_ana', kind: 'professional', name: 'Dra. Ana', active: true },
        { id: 'pro_bia', kind: 'professional', name: 'Dra. Bia', active: true },
      ],
      weeklyWindows: [],
      blocks: [],
      readiness: { schedulingAllowed: true },
    })),
    getPix: vi.fn(async () => ({
      account: { canCreateCharge: true },
      signalSettings: {
        enabled: true,
        amountKind: 'fixed',
        fixedCents: 9000,
        percent: null,
        deadlineSeconds: 1800,
        policyKind: 'credit_next',
        creditWindowMinutes: 24 * 60,
        creditWindowHours: 24,
        bookingLeadMinutes: 0,
        customPolicyText: '',
        cancellationPolicy: '',
        preview: {
          booking: '',
          reschedule: '',
          cancel: '',
          combined: '',
          generated: true,
        },
        updatedAt: 0,
      },
    })),
    getInboxConversation: vi.fn(async () => ({
      contact: { id: 'c1', waId: '5511987654321', displayName: 'Marina Souza', createdAt: 0 },
      messagingWindow: { open: opts.windowOpen ?? true, lastInboundAt: 0, closesAt: 0, remainingMs: 1 },
    })),
    getInboxContact: vi.fn(),
    queryAvailability: vi.fn(async (_t: string, q: { date: string }) => {
      if (!firstDay.value) firstDay.value = q.date
      if (opts.emptyFirstDay && q.date === firstDay.value) {
        return { date: q.date, slots: [] }
      }
      return { date: q.date, slots: [slot(q.date, 9), slot(q.date, 14, 15)] }
    }),
    checkAvailabilitySlot: vi.fn(async () => ({ available: true, reasons: [] })),
    confirmAppointment: vi.fn(async () => ({ id: 'apt_1' })),
    confirmWithoutSignal: vi.fn(async () => ({ appointmentId: 'apt_2' })),
    createPixCharge: vi.fn(async () => ({ charge: { amountCents: 9000 }, whatsappSendError: null })),
    sendClientWebLink: vi.fn(
      async (): Promise<{ status: 'sent' | 'window_closed' | 'unavailable' | 'not_found' }> => ({ status: 'sent' }),
    ),
    confirmPixAlertSlot: vi.fn(),
    sendInboxMessage: vi.fn(async () => ({})),
  }
  return api
}

function renderScreen(api: ReturnType<typeof makeApi>) {
  return render(<AgendarScreen tenantId="t1" api={api as unknown as PanelApi} generation={1} />)
}

beforeEach(() => {
  window.history.replaceState(null, '', '/t/t1/agenda/agendar?conversationId=conv_1&contactId=c1')
  navigatePanel.mockReset()
})
afterEach(cleanup)

async function pickTime(label = '14:15') {
  const btn = await screen.findByRole('button', { name: label })
  fireEvent.click(btn)
  return btn
}

describe('AgendarScreen (TEL-05 redesenho)', () => {
  it('DEC-077: hora com tempo fraco continua selecionável e o aviso volta na revisão', async () => {
    const api = makeApi()
    api.queryAvailability.mockImplementation(async (_t: string, q: { date: string }) => ({
      date: q.date,
      slots: [{ ...slot(q.date, 15), tempoWarnings: ['Sol fraco neste horário', 'Abaixo de 24 °C neste horário'] }],
    }))
    renderScreen(api)
    await pickTime('15:00')
    const chosen = screen.getByRole('status')
    expect(chosen.textContent).toContain('Sol fraco neste horário')
    expect(chosen.textContent).toContain('Abaixo de 24 °C neste horário')
    expect(screen.getByRole('button', { name: 'Revisar' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('status').textContent).toContain('Sol fraco neste horário')
    expect(within(dialog).getByRole('status').textContent).toContain('Abaixo de 24 °C neste horário')
    expect(within(dialog).getByRole('button', { name: 'Enviar link de agenda' }).hasAttribute('disabled')).toBe(true)
    expect(api.sendClientWebLink).not.toHaveBeenCalled()
    expect(api.confirmAppointment).not.toHaveBeenCalled()
  })

  it('mostra o contato real, cartões de serviço e «Qualquer» primeiro', async () => {
    const api = makeApi()
    renderScreen(api)
    expect(await screen.findByRole('heading', { name: 'Agendar · Marina Souza' })).toBeTruthy()
    expect(screen.getByText(/\+55 11 9••••-4321 · da conversa/)).toBeTruthy()
    const cliente = screen.getByRole('region', { name: 'Cliente' })
    expect(within(cliente).getByText('Marina Souza')).toBeTruthy()
    expect(within(cliente).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: /Escolha a cliente/ })).toBeNull()
    expect(screen.queryByRole('searchbox', { name: 'Buscar pelo nome' })).toBeNull()
    expect(screen.queryByText(/Contato sintético/)).toBeNull()
    const svc = screen.getByRole('button', { name: /Limpeza/ })
    expect(svc.getAttribute('aria-pressed')).toBe('true')
    const pros = within(screen.getByRole('group', { name: 'Profissional' })).getAllByRole('button')
    expect(pros[0]!.textContent).toBe('Qualquer')
    expect(pros[0]!.getAttribute('aria-pressed')).toBe('true')
  })

  it('separa horários em Manhã e Tarde e só libera o rodapé com horário', async () => {
    renderScreen(makeApi())
    const manha = await screen.findByRole('group', { name: 'Manhã' })
    expect(within(manha).getByRole('button', { name: '09:00' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Tarde' })).getByRole('button', { name: '14:15' })).toBeTruthy()
    const cta = screen.getByRole('button', { name: 'Revisar' })
    expect(cta.hasAttribute('disabled') || cta.getAttribute('data-disabled') === 'true').toBe(true)
    const t = await pickTime()
    expect(t.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Revisar' }).hasAttribute('disabled')).toBe(false)
  })

  it('DEC-202: com conversa envia o link da página e não confirma o horário', async () => {
    const api = makeApi()
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Revisar' })).toBeTruthy()
    expect(within(dialog).getByText('Marina Souza')).toBeTruthy()
    expect(within(dialog).getByText(/botão «Abrir agenda» já neste serviço/)).toBeTruthy()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar link de agenda' }))
    expect(await screen.findByRole('heading', { name: 'Link enviado' })).toBeTruthy()
    expect(api.sendClientWebLink).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        conversationId: 'conv_1',
        purpose: 'agendar',
        serviceId: 'svc_limpeza',
      }),
      expect.anything(),
    )
    expect(api.confirmAppointment).not.toHaveBeenCalled()
    expect(api.sendInboxMessage).not.toHaveBeenCalled()
    expect(screen.getByText('Aguarda a cliente na página')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Voltar à conversa' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ver na agenda' })).toBeNull()
  })

  it('janela de 24 h fechada: o link não sai e a equipe vê o motivo', async () => {
    const api = makeApi({ windowOpen: false })
    api.sendClientWebLink.mockResolvedValueOnce({ status: 'window_closed' })
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/janela de 24 h está fechada/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar link de agenda' }))
    expect((await screen.findByRole('alert')).textContent).toContain('janela de 24 h')
    expect(api.confirmAppointment).not.toHaveBeenCalled()
  })

  it('DEC-076: não há controle de duração, mesmo com o campo antigo no serviço', async () => {
    renderScreen(makeApi({ service: { durationAdjustable: true, durationMinMinutes: 30, durationMaxMinutes: 90 } }))
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    expect(screen.queryByRole('button', { name: 'Aumentar 15 min' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Diminuir 15 min' })).toBeNull()
  })

  it('conflito: «Nada foi reservado», mantém serviço e profissional', async () => {
    const api = makeApi()
    api.checkAvailabilitySlot.mockResolvedValueOnce({ available: false, reasons: [] })
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    fireEvent.click(screen.getByRole('button', { name: 'Dra. Ana' }))
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: /Marcar já/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar e enviar' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Nada foi reservado')
    expect(alert.textContent).toContain('Suas escolhas foram mantidas')
    await waitFor(() => expect(document.activeElement).toBe(alert))
    expect(screen.getByRole('button', { name: /Limpeza/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Dra. Ana' }).getAttribute('aria-pressed')).toBe('true')
    expect(api.confirmAppointment).not.toHaveBeenCalled()
    expect(api.sendClientWebLink).not.toHaveBeenCalled()
  })

  it('dia sem horários oferece «Próximo livre»', async () => {
    const api = makeApi({ emptyFirstDay: true })
    renderScreen(api)
    expect(await screen.findByText('Sem horários livres neste dia.')).toBeTruthy()
    const next = await screen.findByRole('button', { name: /Próximo livre: .*09:00/ })
    fireEvent.click(next)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Revisar' }).hasAttribute('disabled')).toBe(false),
    )
  })

  it('sinal Pix com conversa: proposta inclui o sinal (sem marcar)', async () => {
    const api = makeApi({ service: { requiresSignal: true, signalKind: 'fixed', signalFixedCents: 9000 } })
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Revisar' })).toBeTruthy()
    expect(within(dialog).getByText(/Sinal Pix de/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar link de agenda' }))
    expect(await screen.findByRole('heading', { name: 'Link enviado' })).toBeTruthy()
    expect(api.sendClientWebLink).toHaveBeenCalled()
    expect(api.createPixCharge).not.toHaveBeenCalled()
    expect(api.confirmWithoutSignal).not.toHaveBeenCalled()
  })

  it('Voltar regressa à conversa de origem', async () => {
    renderScreen(makeApi())
    await screen.findByRole('heading', { name: /Marina/ })
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(navigatePanel).toHaveBeenCalledWith(
      expect.objectContaining({ area: 'conversas', section: 'thread', conversationId: 'conv_1' }),
    )
  })
})

describe('AgendarScreen embutido nas Conversas (DEC-074)', () => {
  function renderEmbedded(api: ReturnType<typeof makeApi>, onClose: () => void) {
    // A URL não traz contexto: tudo vem da conversa aberta.
    window.history.replaceState(null, '', '/t/t1/conversas/conv_9')
    return render(
      <AgendarScreen
        tenantId="t1"
        api={api as unknown as PanelApi}
        generation={1}
        embedded={{ conversationId: 'conv_1', contactId: 'c1', onClose }}
      />,
    )
  }

  it('usa a conversa recebida, não a URL, e «Fechar Agendar» só fecha o painel', async () => {
    const onClose = vi.fn()
    const api = makeApi()
    renderEmbedded(api, onClose)
    expect(await screen.findByRole('heading', { name: 'Agendar · Marina Souza' })).toBeTruthy()
    expect(api.getInboxConversation).toHaveBeenCalledWith('t1', 'conv_1', expect.anything(), expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Fechar Agendar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(navigatePanel).not.toHaveBeenCalled()
  })

  it('depois de enviar o link, «Voltar à conversa» fecha o painel sem trocar de área', async () => {
    const onClose = vi.fn()
    const api = makeApi()
    renderEmbedded(api, onClose)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar link de agenda' }))
    await screen.findByRole('heading', { name: 'Link enviado' })
    expect(api.sendClientWebLink).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ conversationId: 'conv_1' }),
      expect.anything(),
    )
    expect(api.confirmAppointment).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à conversa' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(navigatePanel).not.toHaveBeenCalled()
  })
})


describe('AgendarScreen — «Para quem» e variantes sem «Ambos»', () => {
  const z = (id: string, name: string, audience: string, sortOrder: number) => ({
    id, name, audience, sortOrder, active: true, durationMinutes: 10, priceCents: 5000,
  })
  const depil = {
    variantKind: 'Zona',
    variantKindPlural: 'Zonas',
    variantSelection: 'varias',
    zones: [
      z('axm', 'Axila', 'masculino', 0),
      z('axf', 'Axila', 'feminino', 1),
      z('buc', 'Buço', 'feminino', 2),
      z('sob', 'Sobrancelha', 'ambos', 3),
    ],
  }

  it('pede a linha antes das zonas e filtra sem rótulo de gênero', async () => {
    renderScreen(makeApi({ service: depil }))
    expect(await screen.findByRole('radiogroup', { name: 'Para quem' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Buço/ })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Feminino' }))
    expect(screen.getByRole('button', { name: /Buço/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sobrancelha/ })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Axila/ })).toHaveLength(1)
    expect(screen.queryByText(/Ambos/)).toBeNull()
    expect(screen.queryByText(/· Feminino ·/)).toBeNull()
  })

  it('trocar a linha tira só as da outra linha e permite desfazer', async () => {
    renderScreen(makeApi({ service: depil }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Feminino' }))
    fireEvent.click(screen.getByRole('button', { name: /Buço/ }))
    fireEvent.click(screen.getByRole('button', { name: /Sobrancelha/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'Masculino' }))
    expect(screen.getByText(/Tiramos Buço \(feminino\)/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sobrancelha/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    expect(screen.getByRole('button', { name: /Buço/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('serviço só unissex não mostra «Para quem»', async () => {
    renderScreen(makeApi({ service: { ...depil, zones: [z('a', 'Ventosaterapia', 'ambos', 0)] } }))
    expect(await screen.findByRole('button', { name: /Ventosaterapia/ })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Para quem' })).toBeNull()
    expect(screen.queryByText(/Ambos/)).toBeNull()
  })

  it('revisão usa a linha do Agendar mesmo com variantes só «ambos»', async () => {
    renderScreen(
      makeApi({
        service: {
          ...depil,
          name: 'Depilação',
          zones: [
            z('axm', 'Axila', 'masculino', 0),
            z('axf', 'Axila', 'feminino', 1),
            z('sob', 'Sobrancelha', 'ambos', 2),
          ],
        },
      }),
    )
    fireEvent.click(await screen.findByRole('radio', { name: 'Feminino' }))
    fireEvent.click(screen.getByRole('button', { name: /Sobrancelha/ }))
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Depilação · Feminino ·/)).toBeTruthy()
  })
})

describe('AgendarScreen — painel único', () => {
  it('não mostra o alternador Horário exato | Por período no topo', async () => {
    renderScreen(makeApi())
    await screen.findByRole('heading', { name: /Marina/ })
    expect(screen.queryByRole('radiogroup', { name: 'Como escolher o horário' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reservar bloco' })).toBeTruthy()
  })

  it('«Marcar já» confirma direto, avisa pelo WhatsApp e não envia o link', async () => {
    const api = makeApi()
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: /Marcar já/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar e enviar' }))
    await waitFor(() => expect(api.confirmAppointment).toHaveBeenCalled())
    await waitFor(() => expect(api.sendInboxMessage).toHaveBeenCalled())
    expect(api.sendClientWebLink).not.toHaveBeenCalled()
  })

  it('serviço com sinal Pix não oferece «Marcar já» (só o link)', async () => {
    const api = makeApi({ service: { requiresSignal: true, signalKind: 'fixed', signalFixedCents: 9000 } })
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('radio', { name: /Marcar já/ })).toBeNull()
    expect(within(dialog).queryByRole('radiogroup', { name: 'Como concluir' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Enviar link de agenda' })).toBeTruthy()
  })

  it('serviço com variantes não oferece o bloco (DEC-150)', async () => {
    renderScreen(
      makeApi({
        service: {
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          zones: [{ id: 'a', name: 'Axila', audience: 'ambos', sortOrder: 0, active: true, durationMinutes: 10, priceCents: 5000 }],
        },
      }),
    )
    await screen.findByRole('button', { name: /Axila/ })
    expect(screen.queryByRole('button', { name: 'Reservar bloco' })).toBeNull()
  })
})

describe('Agendar pela Agenda sem cliente (DEC-203)', () => {
  const directory = [
    { id: 'c_marina', waId: '5511987654321', displayName: 'Marina Souza', createdAt: 0, blockedAt: null },
    { id: 'c_lia', waId: '5511977770000', displayName: 'Lia Costa', createdAt: 0, blockedAt: null },
  ]

  function withDirectory(api: ReturnType<typeof makeApi>) {
    return Object.assign(api, {
      listInboxContacts: vi.fn(async (_t: string, query?: { q?: string }) => {
        const q = (query?.q ?? '').trim().toLowerCase()
        const contacts = q
          ? directory.filter((c) => (c.displayName ?? '').toLowerCase().includes(q))
          : directory
        return { contacts, nextBefore: null }
      }),
    })
  }

  function ctaDisabled() {
    const cta = screen.getByRole('button', { name: 'Revisar e confirmar', hidden: true })
    return cta.hasAttribute('disabled') || cta.getAttribute('data-disabled') === 'true' || cta.getAttribute('aria-disabled') === 'true'
  }

  beforeEach(() => {
    window.history.replaceState(null, '', '/t/t1/agenda/agendar')
  })

  it('sem cliente escolhida, «Revisar e confirmar» fica desativado mesmo com horário', async () => {
    renderScreen(withDirectory(makeApi()))
    expect(await screen.findByRole('heading', { name: 'Agendar horário' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Escolha a cliente/ })).toBeTruthy()
    expect(screen.queryByRole('searchbox', { name: 'Buscar pelo nome' })).toBeNull()
    await pickTime()
    expect(ctaDisabled()).toBe(true)
    expect(screen.getByText(/escolha a cliente/)).toBeTruthy()
  })

  it('texto digitado na busca não conta como cliente e não há criar cliente', async () => {
    const api = withDirectory(makeApi())
    renderScreen(api)
    await screen.findByRole('heading', { name: 'Agendar horário' })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: /Escolha a cliente/ }))
    const search = await screen.findByRole('searchbox', { name: 'Buscar pelo nome' })
    fireEvent.change(search, { target: { value: 'Pessoa inventada' } })
    expect(await screen.findByText('Nenhum cliente com esse nome.')).toBeTruthy()
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.queryByRole('button', { name: /Nova cliente|Criar cliente/ })).toBeNull()
    expect(api.listInboxContacts).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ q: 'Pessoa inventada' }),
      expect.anything(),
    )
    expect(ctaDisabled()).toBe(true)
    expect(api.confirmAppointment).not.toHaveBeenCalled()
  })

  it('escolhe da lista, mostra o nome no rodapé e confirma com esse contactId', async () => {
    const api = withDirectory(makeApi())
    renderScreen(api)
    await screen.findByRole('heading', { name: 'Agendar horário' })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: /Escolha a cliente/ }))
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Buscar pelo nome' }), {
      target: { value: 'Marina' },
    })
    await waitFor(() => expect(screen.queryByRole('option', { name: /Lia Costa/ })).toBeNull())
    const option = screen.getByRole('option', { name: /Marina Souza/ })
    expect(api.listInboxContacts).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ q: 'Marina' }),
      expect.anything(),
    )
    fireEvent.click(option)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Agendar · Marina Souza' })).toBeTruthy()
    const summary = document.querySelector('.agd-summary')
    expect(summary?.textContent).toContain('Limpeza')
    expect(summary?.textContent).toContain('Marina Souza')
    expect(ctaDisabled()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Revisar e confirmar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Marina Souza')).toBeTruthy()
    expect(within(dialog).queryByText('Sem contato vinculado')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar agendamento' }))
    await waitFor(() => expect(api.confirmAppointment).toHaveBeenCalled())
    expect(api.confirmAppointment).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        contactId: 'c_marina',
        contactLabel: 'Marina Souza',
        conversationId: undefined,
      }),
      expect.anything(),
    )
    expect(api.sendClientWebLink).not.toHaveBeenCalled()
  })

  it('com contactId e sem conversa mostra a cliente já associada e não pede outra', async () => {
    window.history.replaceState(null, '', '/t/t1/agenda/agendar?contactId=c1')
    const api = makeApi()
    api.getInboxContact.mockResolvedValue({
      contact: { id: 'c1', waId: '5511987654321', displayName: 'Marina Souza', createdAt: 0 },
      conversations: [],
    })
    renderScreen(api)
    expect(await screen.findByRole('heading', { name: 'Agendar · Marina Souza' })).toBeTruthy()
    expect(screen.getByText(/da agenda/)).toBeTruthy()
    const cliente = screen.getByRole('region', { name: 'Cliente' })
    expect(within(cliente).getByText('Marina Souza')).toBeTruthy()
    expect(within(cliente).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: /Escolha a cliente/ })).toBeNull()
    await pickTime()
    const cta = screen.getByRole('button', { name: 'Revisar e confirmar' })
    expect(cta.hasAttribute('disabled') || cta.getAttribute('aria-disabled') === 'true').toBe(false)
    fireEvent.click(cta)
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar agendamento' }))
    await waitFor(() => expect(api.confirmAppointment).toHaveBeenCalled())
    expect(api.confirmAppointment).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ contactId: 'c1', conversationId: undefined }),
      expect.anything(),
    )
    expect('listInboxContacts' in api).toBe(false)
  })
})
