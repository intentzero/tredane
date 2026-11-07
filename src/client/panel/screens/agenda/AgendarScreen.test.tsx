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
      signalSettings: { deadlineSeconds: 7200, cancellationPolicy: '', updatedAt: 0 },
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
    createAndSendProposal: vi.fn(
      async (): Promise<{
        appointmentCreated: false
        sendStatus: 'queued' | 'already_sent' | 'handed_off_closed_window'
        proposal: {
          id: string
          version: number
          state: string
          serviceName: string
          startsAt: number
          endsAt: number
          expiresAt: number | null
          requiresSignal: boolean
          resultKind: string | null
          sendProviderMessageId: string | null
        }
      }> => ({
        appointmentCreated: false,
        sendStatus: 'queued',
        proposal: {
          id: 'aprop_1',
          version: 1,
          state: 'envio_pendente',
          serviceName: 'Limpeza',
          startsAt: 0,
          endsAt: 0,
          expiresAt: null,
          requiresSignal: false,
          resultKind: null,
          sendProviderMessageId: null,
        },
      }),
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
    expect(within(dialog).getByRole('button', { name: 'Enviar proposta' }).hasAttribute('disabled')).toBe(true)
    expect(api.createAndSendProposal).not.toHaveBeenCalled()
    expect(api.confirmAppointment).not.toHaveBeenCalled()
  })

  it('mostra o contato real, cartões de serviço e «Qualquer» primeiro', async () => {
    const api = makeApi()
    renderScreen(api)
    expect(await screen.findByRole('heading', { name: 'Agendar · Marina Souza' })).toBeTruthy()
    expect(screen.getByText(/\+55 11 9••••-4321 · da conversa/)).toBeTruthy()
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

  it('DEC-061: com conversa envia proposta versionada e não confirma o horário', async () => {
    const api = makeApi()
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Revisar' })).toBeTruthy()
    expect(within(dialog).getByText('Marina Souza')).toBeTruthy()
    expect(within(dialog).getByText(/botões Confirmar e Alterar detalhes/)).toBeTruthy()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar proposta' }))
    expect(await screen.findByRole('heading', { name: 'Proposta enviada' })).toBeTruthy()
    expect(api.createAndSendProposal).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        contactId: 'c1',
        conversationId: 'conv_1',
        serviceId: 'svc_limpeza',
      }),
      expect.anything(),
    )
    expect(api.confirmAppointment).not.toHaveBeenCalled()
    expect(api.sendInboxMessage).not.toHaveBeenCalled()
    expect(screen.getByText('Aguarda confirmação no WhatsApp')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Voltar à conversa' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ver na agenda' })).toBeNull()
  })

  it('janela de 24 h fechada: ainda oferece enviar proposta (handoff)', async () => {
    const api = makeApi({ windowOpen: false })
    api.createAndSendProposal.mockResolvedValueOnce({
      appointmentCreated: false as const,
      sendStatus: 'handed_off_closed_window' as const,
      proposal: {
        id: 'aprop_2',
        version: 1,
        state: 'envio_pendente',
        serviceName: 'Limpeza',
        startsAt: 0,
        endsAt: 0,
        expiresAt: null,
        requiresSignal: false,
        resultKind: null,
        sendProviderMessageId: null,
      },
    })
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/janela de 24 h está fechada/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar proposta' }))
    expect(await screen.findByRole('heading', { name: 'Proposta enviada' })).toBeTruthy()
    expect(screen.getByText(/Proposta preparada · janela fechada/)).toBeTruthy()
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
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar proposta' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Nada foi reservado')
    expect(alert.textContent).toContain('Suas escolhas foram mantidas')
    await waitFor(() => expect(document.activeElement).toBe(alert))
    expect(screen.getByRole('button', { name: /Limpeza/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Dra. Ana' }).getAttribute('aria-pressed')).toBe('true')
    expect(api.confirmAppointment).not.toHaveBeenCalled()
    expect(api.createAndSendProposal).not.toHaveBeenCalled()
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
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar proposta' }))
    expect(await screen.findByRole('heading', { name: 'Proposta enviada' })).toBeTruthy()
    expect(api.createAndSendProposal).toHaveBeenCalled()
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

  it('depois de enviar proposta, «Voltar à conversa» fecha o painel sem trocar de área', async () => {
    const onClose = vi.fn()
    const api = makeApi()
    renderEmbedded(api, onClose)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar proposta' }))
    await screen.findByRole('heading', { name: 'Proposta enviada' })
    expect(api.createAndSendProposal).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ conversationId: 'conv_1', contactId: 'c1' }),
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
})

describe('AgendarScreen — painel único', () => {
  it('não mostra o alternador Horário exato | Por período no topo', async () => {
    renderScreen(makeApi())
    await screen.findByRole('heading', { name: /Marina/ })
    expect(screen.queryByRole('radiogroup', { name: 'Como escolher o horário' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reservar bloco' })).toBeTruthy()
  })

  it('«Marcar já» confirma direto, avisa pelo WhatsApp e não envia proposta', async () => {
    const api = makeApi()
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: /Marcar já/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar e enviar' }))
    await waitFor(() => expect(api.confirmAppointment).toHaveBeenCalled())
    expect(api.createAndSendProposal).not.toHaveBeenCalled()
  })

  it('serviço com variantes não oferece o bloco (DEC-149)', async () => {
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
