import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../ui/panel.css'
import { PanelApiError, type PanelApi } from '../api'
import { SupportView, formatRemaining } from './SupportView'

const T0 = 1_800_000_000_000
const context = {
  tenantId: 'clinic-demo-a',
  name: 'Clínica Demo A',
  status: 'active' as const,
  role: 'owner' as const,
  support: { sessionId: 'ssn_1', expiresAt: T0 + 30 * 60_000 },
}
const conv = {
  id: 'conv_1',
  contact: { id: 'ct_1', waId: '••••1234', displayName: 'Ana Exemplo', createdAt: 1 },
  lastMessagePreview: 'Quero marcar',
  lastMessageAt: T0 - 60_000,
}
const detail = {
  ...conv,
  messages: [
    { id: 'm2', direction: 'outbound', body: 'Claro!', createdAt: T0 - 30_000 },
    { id: 'm1', direction: 'inbound', body: 'Quero marcar', createdAt: T0 - 60_000 },
  ],
}

function fakeApi(over: Record<string, unknown> = {}) {
  return {
    listInboxConversations: vi.fn(async () => ({ conversations: [conv], nextBefore: null, counts: {} })),
    getInboxConversation: vi.fn(async () => detail),
    getTenantContext: vi.fn(async () => context),
    endSupportSession: vi.fn(async () => undefined),
    ...over,
  } as unknown as PanelApi & Record<string, ReturnType<typeof vi.fn>>
}

async function noAxe(container: HTMLElement) {
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  expect(r.violations, JSON.stringify(r.violations, null, 2)).toEqual([])
}

describe('SupportView — modo de suporte só de leitura (#853, ADR-0017 §5)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(T0)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('formata a contagem decrescente', () => {
    expect(formatRemaining(30 * 60_000)).toBe('30:00')
    expect(formatRemaining(61_000)).toBe('01:01')
    expect(formatRemaining(-5)).toBe('00:00')
  })

  it('mostra o banner permanente com a clínica e o tempo, lê a conversa e não tem nenhum controlo de escrita', async () => {
    const api = fakeApi()
    const { container } = render(<SupportView context={context} api={api} now={() => Date.now()} />)
    const banner = screen.getByRole('region', { name: 'Sessão de suporte' })
    expect(within(banner).getByText(/somente leitura/i)).toBeTruthy()
    expect(within(banner).getByText(/Clínica Demo A/)).toBeTruthy()
    expect(within(banner).getByText('30:00')).toBeTruthy()

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(await screen.findByRole('button', { name: /Ana Exemplo/ }))
    expect(await screen.findByText('Claro!')).toBeTruthy()
    // Ordem cronológica: a mensagem da cliente vem primeiro.
    const items = screen.getAllByRole('listitem').filter((li) => li.className.includes('support-msg'))
    expect(items[0]!.textContent).toContain('Quero marcar')

    // Só há um botão de ação além da lista: «Encerrar sessão». Sem caixa de texto, sem enviar, atribuir ou fechar.
    expect(screen.queryByRole('textbox')).toBeNull()
    const actions = screen.getAllByRole('button').map((b) => b.textContent)
    expect(actions.filter((t) => !/Ana Exemplo/.test(t ?? ''))).toEqual(['Encerrar sessão'])
    // Nunca chama nada que escreva.
    expect(Object.keys(api).filter((k) => /send|assign|close|read|block|delete|resume|decide/i.test(k) && api[k]!.mock.calls.length > 0)).toEqual([])
    await noAxe(container)
  })

  it('a contagem desce e, abaixo de 5 minutos, é anunciada; a zero a sessão acaba sozinha', async () => {
    const api = fakeApi()
    render(<SupportView context={context} api={api} now={() => Date.now()} />)
    await act(async () => {
      vi.advanceTimersByTime(26 * 60_000)
    })
    expect(screen.getByRole('status').textContent).toMatch(/menos de 5 minutos/)
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000)
    })
    expect(await screen.findByText('Sessão de suporte encerrada')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Sessão de suporte' })).toBeNull()
    expect(screen.queryByText('Ana Exemplo')).toBeNull()
  })

  it('«Encerrar sessão» chama o servidor e mostra o ecrã de fim com a volta ao Platform Admin', async () => {
    const api = fakeApi()
    const goToAdmin = vi.fn()
    render(<SupportView context={context} api={api} goToAdmin={goToAdmin} now={() => Date.now()} />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('button', { name: 'Encerrar sessão' }))
    expect(api.endSupportSession).toHaveBeenCalledWith('ssn_1')
    await user.click(await screen.findByRole('button', { name: 'Voltar ao Platform Admin' }))
    expect(goToAdmin).toHaveBeenCalledTimes(1)
  })

  it('falha ao encerrar: avisa e mantém a sessão; se o servidor diz que já acabou, termina', async () => {
    const api = fakeApi({ endSupportSession: vi.fn(async () => { throw new PanelApiError(500, 'internal') }) })
    render(<SupportView context={context} api={api} now={() => Date.now()} />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('button', { name: 'Encerrar sessão' }))
    expect(await screen.findByText('Não foi possível encerrar a sessão')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Sessão de suporte' })).toBeTruthy()
    cleanup()

    const gone = fakeApi({ endSupportSession: vi.fn(async () => { throw new PanelApiError(409, 'support_revoke_conflict') }) })
    render(<SupportView context={context} api={gone} now={() => Date.now()} />)
    await user.click(screen.getByRole('button', { name: 'Encerrar sessão' }))
    expect(await screen.findByText('Sessão de suporte encerrada')).toBeTruthy()
  })

  it('revogada pelo owner: a revalidação periódica (403) e a lista recusada cortam a vista e limpam os dados', async () => {
    const api = fakeApi({ getTenantContext: vi.fn(async () => { throw new PanelApiError(403, 'tenant_access_denied') }) })
    render(<SupportView context={context} api={api} now={() => Date.now()} />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(await screen.findByRole('button', { name: /Ana Exemplo/ }))
    expect(await screen.findByText('Claro!')).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(31_000)
    })
    await waitFor(() => expect(screen.getByText('Sessão de suporte encerrada')).toBeTruthy())
    expect(screen.queryByText('Claro!')).toBeNull()
    expect(screen.queryByText('Ana Exemplo')).toBeNull()

    cleanup()
    const refused = fakeApi({ listInboxConversations: vi.fn(async () => { throw new PanelApiError(403, 'support_session_not_active') }) })
    render(<SupportView context={context} api={refused} now={() => Date.now()} />)
    expect(await screen.findByText('Sessão de suporte encerrada')).toBeTruthy()
  })
})
