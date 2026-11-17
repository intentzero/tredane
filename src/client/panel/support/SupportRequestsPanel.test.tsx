// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../ui/panel.css'
import { PanelApiError, type PanelApi, type SupportRequestLite, type TeamMemberLite } from '../api'
import { SupportRequestsPanel, remainingLabel } from './SupportRequestsPanel'

const NOW = 1_800_000_000_000
const H = 3_600_000

const members: TeamMemberLite[] = [
  { clerkUserId: 'u_ana', displayName: 'Ana Souza', email: 'ana@exemplo.test', role: 'attendant', status: 'active' },
  { clerkUserId: 'u_bia', displayName: 'Bia Lima', email: 'bia@exemplo.test', role: 'owner', status: 'active' },
]

function request(over: Partial<SupportRequestLite> = {}): SupportRequestLite {
  return {
    id: 'sar_1',
    tenantId: 'clinic-a',
    actorClerkUserId: 'u_tredane',
    subjectClerkUserId: 'u_ana',
    reason: 'Investigar falha de envio relatada pela clínica',
    scope: 'read_diagnostics',
    status: 'pending',
    decidedByOwnerClerkUserId: null,
    decidedAt: null,
    createdAt: NOW - H,
    expiresAt: NOW + 23 * H,
    ...over,
  }
}

function fakeApi(rows: SupportRequestLite[], decide?: () => Promise<void>) {
  return {
    listSupportRequests: vi.fn(async () => ({ requests: rows })),
    decideSupportRequest: vi.fn(decide ?? (async () => undefined)),
  } as unknown as PanelApi & {
    listSupportRequests: ReturnType<typeof vi.fn>
    decideSupportRequest: ReturnType<typeof vi.fn>
  }
}

function mount(api: PanelApi, extra: Partial<Parameters<typeof SupportRequestsPanel>[0]> = {}) {
  return render(
    <SupportRequestsPanel tenantId="clinic-a" api={api} generation={1} members={members} {...extra} />,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SupportRequestsPanel (#897, TEL-10 M-27, AC-84 do lado da clínica)', () => {
  it('sem pedidos pendentes não mostra nada', async () => {
    const api = fakeApi([request({ status: 'approved' }), request({ id: 'sar_2', status: 'expired' })])
    const { container } = mount(api)
    await waitFor(() => expect(api.listSupportRequests).toHaveBeenCalled())
    expect(container.querySelector('.panel-banner')).toBeNull()
  })

  it('pedido pendente aparece como faixa com o prazo e «Ver pedido»', async () => {
    mount(fakeApi([request()]))
    expect(await screen.findByText('O Tredane pediu para ler as conversas desta clínica')).toBeTruthy()
    expect(screen.getByText(/Aguardando sua decisão: expira em 23 h\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver pedido' })).toBeTruthy()
  })

  it('o detalhe diz quem pede, em nome de quem (pelo nome), o motivo, o que poderá e a duração', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mount(fakeApi([request()]))
    await user.click(await screen.findByRole('button', { name: 'Ver pedido' }))
    const dialog = await screen.findByRole('dialog', { name: 'Pedido de suporte' })
    expect(dialog.textContent).toContain('Equipe do Tredane')
    expect(dialog.textContent).toContain('Ana Souza')
    expect(dialog.textContent).toContain('(Atendente)')
    expect(dialog.textContent).toContain('Investigar falha de envio')
    expect(dialog.textContent).toContain('Ler as conversas e os contatos')
    expect(dialog.textContent).toContain('4 últimos dígitos')
    expect(dialog.textContent).toContain('30 minutos')
    expect(dialog.textContent).not.toContain('u_ana')
  })

  it('Aprovar suporte chama a API com «approve», fecha e avisa o ecrã', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const api = fakeApi([request()])
    const onDecided = vi.fn()
    mount(api, { onDecided })
    await user.click(await screen.findByRole('button', { name: 'Ver pedido' }))
    await user.click(await screen.findByRole('button', { name: 'Aprovar suporte' }))
    await waitFor(() => expect(api.decideSupportRequest).toHaveBeenCalledWith('clinic-a', 'sar_1', 'approve', expect.anything()))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onDecided).toHaveBeenCalledWith(expect.stringContaining('Suporte aprovado'))
    expect(onDecided.mock.calls[0]![0]).toContain('Ana Souza')
  })

  it('Rejeitar chama a API com «reject»', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const api = fakeApi([request()])
    const onDecided = vi.fn()
    mount(api, { onDecided })
    await user.click(await screen.findByRole('button', { name: 'Ver pedido' }))
    await user.click(await screen.findByRole('button', { name: 'Rejeitar' }))
    await waitFor(() => expect(api.decideSupportRequest).toHaveBeenCalledWith('clinic-a', 'sar_1', 'reject', expect.anything()))
    expect(onDecided).toHaveBeenCalledWith(expect.stringContaining('rejeitado'))
  })

  it('outra responsável decidiu primeiro: o erro aparece em português e a lista é relida', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const api = fakeApi([request()], async () => {
      throw new PanelApiError(409, 'unknown' as never, 'support_request_not_pending')
    })
    mount(api)
    await user.click(await screen.findByRole('button', { name: 'Ver pedido' }))
    const calls = api.listSupportRequests.mock.calls.length
    await user.click(await screen.findByRole('button', { name: 'Aprovar suporte' }))
    await waitFor(() => expect(api.listSupportRequests.mock.calls.length).toBeGreaterThan(calls))
    expect(screen.queryByText('support_request_not_pending')).toBeNull()
    expect(document.body.textContent).toMatch(/Não deu certo/)
  })

  it('link do e-mail: abre o pedido sozinho quando ainda está pendente', async () => {
    mount(fakeApi([request()]), { openRequestId: 'sar_1' })
    expect(await screen.findByRole('dialog', { name: 'Pedido de suporte' })).toBeTruthy()
  })

  it('link do e-mail com pedido já decidido ou expirado diz isso e não abre nada', async () => {
    const decided = mount(fakeApi([request({ status: 'approved' })]), { openRequestId: 'sar_1' })
    expect(await screen.findByText('Este pedido já não espera decisão')).toBeTruthy()
    expect(screen.getByText(/A primeira decisão vale/)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    decided.unmount()

    mount(fakeApi([request({ expiresAt: NOW - 1 })]), { openRequestId: 'sar_1' })
    expect(await screen.findByText(/O prazo de 24 h acabou/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ver pedido' })).toBeNull()
  })

  it('pedido expirado nunca oferece Aprovar', async () => {
    const api = fakeApi([request({ expiresAt: NOW - 1000 })])
    mount(api)
    await waitFor(() => expect(api.listSupportRequests).toHaveBeenCalled())
    await act(async () => {})
    expect(document.querySelector('.panel-banner')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Aprovar suporte' })).toBeNull()
  })

  it('sem nome da pessoa na Equipe, não mostra o id do Clerk', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mount(fakeApi([request({ subjectClerkUserId: 'u_desconhecido' })]))
    await user.click(await screen.findByRole('button', { name: 'Ver pedido' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('uma pessoa da clínica')
    expect(dialog.textContent).not.toContain('u_desconhecido')
  })

  it('a lista que falha ao carregar avisa e não esconde o resto', async () => {
    const api = {
      listSupportRequests: vi.fn(async () => {
        throw new PanelApiError(500, 'unknown' as never)
      }),
      decideSupportRequest: vi.fn(),
    } as unknown as PanelApi
    mount(api)
    expect(await screen.findByText('Não deu para ver os pedidos de suporte')).toBeTruthy()
  })

  it('acessibilidade: faixa e detalhe sem violações', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { container } = mount(fakeApi([request()]))
    await user.click(await screen.findByRole('button', { name: 'Ver pedido' }))
    await screen.findByRole('dialog')
    const res = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })
    expect(res.violations.map((v) => v.id)).toEqual([])
    expect(container).toBeTruthy()
  })

  it('remainingLabel', () => {
    expect(remainingLabel(NOW + 23 * H, NOW)).toBe('expira em 23 h')
    expect(remainingLabel(NOW + 90 * 60_000, NOW)).toBe('expira em 1 h 30 min')
    expect(remainingLabel(NOW + 59 * 60_000, NOW)).toBe('expira em 59 min')
    expect(remainingLabel(NOW + 1, NOW)).toBe('expira em 1 min')
    expect(remainingLabel(NOW - 1, NOW)).toBe('expirou')
  })
})
