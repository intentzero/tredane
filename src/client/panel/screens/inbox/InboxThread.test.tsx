import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../../ui/panel.css'
import type { InboxConversationDetail, InboxMessage, PanelApi } from '../../api'
import { InboxThread } from './InboxThread'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const NOW = Date.now()
const VIEWER = 'user_ficticio_dono'

function message(over: Partial<InboxMessage>): InboxMessage {
  return {
    id: 'msg_1',
    tenantId: 'clinic-demo-a',
    conversationId: 'cnv_ficticia',
    direction: 'inbound',
    body: 'Oi! Quanto custa a limpeza de pele?',
    externalMessageId: null,
    deliveryState: 'received',
    authorClerkUserId: null,
    authorDisplayName: null,
    createdAt: NOW,
    ...over,
  }
}

function detail(over: Partial<InboxConversationDetail> = {}): InboxConversationDetail {
  return {
    id: 'cnv_ficticia',
    tenantId: 'clinic-demo-a',
    contactId: 'ctc_ficticio',
    status: 'new',
    assigneeClerkUserId: null,
    assigneeDisplayName: null,
    assignmentVersion: 0,
    lastMessageAt: NOW,
    lastMessagePreview: 'Oi!',
    lastMessageDirection: 'inbound',
    unreadCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    contact: { id: 'ctc_ficticio', waId: '5511999000111', displayName: 'Marina Fictícia' },
    messages: [message({})],
    messagesHasMore: false,
    messagesNextBefore: null,
    messagingWindow: { open: true, lastInboundAt: NOW, closesAt: NOW + 3_600_000, remainingMs: 3_600_000 },
    ...over,
  } as unknown as InboxConversationDetail
}

function mockApi(d: InboxConversationDetail, extra: Partial<PanelApi> = {}): PanelApi {
  return {
    getInboxConversation: vi.fn(async () => d),
    listConversationPixCharges: vi.fn(async () => []),
    listPixPaymentAlerts: vi.fn(async () => []),
    listWhatsappTemplates: vi.fn(async () => ({ items: [] })),
    markInboxRead: vi.fn(async () => ({ conversation: d })),
    closeInboxConversation: vi.fn(async () => ({
      conversation: { ...d, status: 'closed' },
      systemMessage: message({ id: 'sys', direction: 'system', body: 'Conversa encerrada' }),
    })),
    ...extra,
  } as unknown as PanelApi
}

function renderThread(api: PanelApi) {
  return render(
    <InboxThread
      tenantId="clinic-demo-a"
      conversationId="cnv_ficticia"
      api={api}
      generation={1}
      viewerClerkUserId={VIEWER}
    />,
  )
}

describe('InboxThread — cabeçalho e Assumir', () => {
  it('sem responsável: mostra a faixa «Ninguém está atendendo» com Assumir', async () => {
    renderThread(mockApi(detail()))
    await screen.findByText('Ninguém está atendendo esta conversa.')
    expect(screen.getByRole('button', { name: 'Assumir' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Agendar horário' })).toBeTruthy()
  })

  it('já é minha: não mostra a faixa Assumir', async () => {
    renderThread(mockApi(detail({ status: 'open', assigneeClerkUserId: VIEWER })))
    await screen.findByText('Marina Fictícia')
    expect(screen.queryByRole('button', { name: 'Assumir' })).toBeNull()
  })

  it('de outra pessoa: diz quem está atendendo', async () => {
    renderThread(
      mockApi(detail({ status: 'open', assigneeClerkUserId: 'user_outro', assigneeDisplayName: 'Bruno' })),
    )
    await screen.findByText('Bruno está atendendo esta conversa.')
  })
})

describe('InboxThread — Encerrar fica no menu e pede confirmação', () => {
  it('não há botão Encerrar solto; o menu leva a uma confirmação que pode ser cancelada', async () => {
    const user = userEvent.setup()
    const api = mockApi(detail({ status: 'open', assigneeClerkUserId: VIEWER }))
    renderThread(api)
    await screen.findByText('Marina Fictícia')
    expect(screen.queryByRole('button', { name: 'Encerrar' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Mais opções da conversa' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Encerrar conversa' }))
    await screen.findByText('Encerrar esta conversa?')
    expect(api.closeInboxConversation).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByText('Encerrar esta conversa?')).toBeNull()
    expect(api.closeInboxConversation).not.toHaveBeenCalled()
  })

  it('confirmar encerra de verdade', async () => {
    const user = userEvent.setup()
    const api = mockApi(detail({ status: 'open', assigneeClerkUserId: VIEWER }))
    renderThread(api)
    await screen.findByText('Marina Fictícia')
    await user.click(screen.getByRole('button', { name: 'Mais opções da conversa' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Encerrar conversa' }))
    await user.click(await screen.findByRole('button', { name: 'Encerrar' }))
    await waitFor(() => expect(api.closeInboxConversation).toHaveBeenCalledTimes(1))
  })
})

describe('InboxThread — bolhas com estado de entrega', () => {
  it('mostra hora e estado dentro da bolha; falha tem «Tentar de novo»', async () => {
    renderThread(
      mockApi(
        detail({
          status: 'open',
          assigneeClerkUserId: VIEWER,
          messages: [
            message({ id: 'a', direction: 'outbound', body: 'Pode ser às 15h?', deliveryState: 'read' }),
            message({ id: 'b', direction: 'outbound', body: 'Segue o valor.', deliveryState: 'failed' }),
          ],
        }),
      ),
    )
    const sent = (await screen.findByText('Pode ser às 15h?')).closest('.inbox-msg-bubble') as HTMLElement
    expect(within(sent).getByText('Lida')).toBeTruthy()
    const failed = screen.getByText('Segue o valor.').closest('.inbox-msg-bubble') as HTMLElement
    expect(failed.className).toContain('inbox-msg-bubble--failed')
    expect(within(failed).getByText('Não enviada')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
  })

  it('mostra «Hoje» e a dica da janela de 24 h', async () => {
    renderThread(mockApi(detail({ status: 'open', assigneeClerkUserId: VIEWER })))
    await screen.findByText('Hoje')
    expect(screen.getByText(/Você pode responder livremente até/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeTruthy()
  })
})
