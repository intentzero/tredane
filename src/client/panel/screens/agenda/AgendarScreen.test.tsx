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
  it('mostra o contato real, cartões de serviço e «Qualquer» primeiro', async () => {
    const api = makeApi()
    renderScreen(api)
    expect(await screen.findByRole('heading', { name: 'Agendar · Marina Souza' })).toBeTruthy()
    expect(screen.getByText(/\+55 11 98765-4321 · da conversa/)).toBeTruthy()
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
    const cta = screen.getByRole('button', { name: 'Revisar e confirmar' })
    expect(cta.hasAttribute('disabled') || cta.getAttribute('data-disabled') === 'true').toBe(true)
    const t = await pickTime()
    expect(t.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Revisar e confirmar' }).hasAttribute('disabled')).toBe(false)
  })

  it('DEC-053: com conversa e janela aberta o aviso vem ligado; desligar e confirmar não envia', async () => {
    const api = makeApi()
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar e confirmar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Marina Souza')).toBeTruthy()
    const toggle = within(dialog).getByRole('checkbox') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Confirmar e enviar' })).toBeTruthy()
    fireEvent.click(toggle)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar agendamento' }))
    expect(await screen.findByRole('heading', { name: 'Horário agendado' })).toBeTruthy()
    expect(api.confirmAppointment).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ contactLabel: 'Marina Souza', conversationId: 'conv_1' }),
      expect.anything(),
    )
    expect(api.sendInboxMessage).not.toHaveBeenCalled()
    expect(screen.getByText('Não enviada (desligado)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Voltar à conversa' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver na agenda' })).toBeTruthy()
  })

  it('envia a mensagem editada quando o aviso está ligado', async () => {
    const api = makeApi()
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar e confirmar' }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    const box = within(dialog).getByRole('textbox', { name: /Mensagem para a paciente/ }) as HTMLTextAreaElement
    expect(box.value).toContain('Oi, Marina!')
    fireEvent.change(box, { target: { value: 'Texto editado' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar e enviar' }))
    expect(await screen.findByText('Mensagem enviada')).toBeTruthy()
    expect(api.sendInboxMessage).toHaveBeenCalledWith('t1', 'conv_1', expect.objectContaining({ body: 'Texto editado' }), expect.anything())
  })

  it('fora da janela de 24 h o aviso fica indisponível', async () => {
    renderScreen(makeApi({ windowOpen: false }))
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar e confirmar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/janela de 24 h está fechada/)).toBeTruthy()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Confirmar agendamento' })).toBeTruthy()
  })

  it('DEC-051: serviço com duração ajustável — passos de 15 min recalculam a grade e vão na confirmação', async () => {
    const api = makeApi({ service: { durationAdjustable: true, durationMinMinutes: 30, durationMaxMinutes: 90 } })
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    const plus = await screen.findByRole('button', { name: 'Aumentar 15 min' })
    fireEvent.click(plus)
    await waitFor(() =>
      expect(api.queryAvailability).toHaveBeenCalledWith('t1', expect.objectContaining({ durationMinutes: 60 }), expect.anything()),
    )
    expect(screen.getByText(/Duração ajustada/)).toBeTruthy()
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar e confirmar' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar e enviar' }))
    await screen.findByRole('heading', { name: 'Horário agendado' })
    expect(api.confirmAppointment).toHaveBeenCalledWith('t1', expect.objectContaining({ durationMinutes: 60 }), expect.anything())
  })

  it('DEC-051: serviço sem duração ajustável não mostra o controle', async () => {
    renderScreen(makeApi())
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    expect(screen.queryByRole('button', { name: 'Aumentar 15 min' })).toBeNull()
  })

  it('conflito: «Nada foi reservado», mantém serviço e profissional', async () => {
    const api = makeApi()
    api.checkAvailabilitySlot.mockResolvedValueOnce({ available: false, reasons: [] })
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    fireEvent.click(screen.getByRole('button', { name: 'Dra. Ana' }))
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar e confirmar' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar e enviar' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Nada foi reservado')
    expect(alert.textContent).toContain('Suas escolhas foram mantidas')
    await waitFor(() => expect(document.activeElement).toBe(alert))
    expect(screen.getByRole('button', { name: /Limpeza/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Dra. Ana' }).getAttribute('aria-pressed')).toBe('true')
    expect(api.confirmAppointment).not.toHaveBeenCalled()
  })

  it('dia sem horários oferece «Próximo livre»', async () => {
    const api = makeApi({ emptyFirstDay: true })
    renderScreen(api)
    expect(await screen.findByText('Sem horários livres neste dia.')).toBeTruthy()
    const next = await screen.findByRole('button', { name: /Próximo livre: .*09:00/ })
    fireEvent.click(next)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Revisar e confirmar' }).hasAttribute('disabled')).toBe(false),
    )
  })

  it('sinal Pix: prazo da clínica e motivo por chips para confirmar sem sinal', async () => {
    const api = makeApi({ service: { requiresSignal: true, signalKind: 'fixed', signalFixedCents: 9000 } })
    renderScreen(api)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar e confirmar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('prazo 2 h')).toBeTruthy()
    expect(within(dialog).getByText('Horário só é reservado após o pagamento')).toBeTruthy()
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Confirmar sem sinal' })[0]!)
    const submit = within(dialog).getAllByRole('button', { name: 'Confirmar sem sinal' })[1]!
    expect(submit.hasAttribute('disabled')).toBe(true)
    const chip = within(dialog).getByRole('button', { name: 'Pagará na clínica' })
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Confirmar sem sinal' })[1]!)
    expect(await screen.findByRole('heading', { name: 'Horário agendado sem sinal' })).toBeTruthy()
    expect(api.confirmWithoutSignal).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ waiveReason: 'Pagará na clínica', contactLabel: 'Marina Souza' }),
      expect.anything(),
    )
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

  it('depois de confirmar, «Voltar à conversa» fecha o painel sem trocar de área', async () => {
    const onClose = vi.fn()
    const api = makeApi()
    renderEmbedded(api, onClose)
    await screen.findByRole('heading', { name: /Marina/ })
    await pickTime()
    fireEvent.click(screen.getByRole('button', { name: 'Revisar e confirmar' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar e enviar' }))
    await screen.findByRole('heading', { name: 'Horário agendado' })
    expect(api.confirmAppointment).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ conversationId: 'conv_1' }),
      expect.anything(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à conversa' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(navigatePanel).not.toHaveBeenCalled()
  })
})

