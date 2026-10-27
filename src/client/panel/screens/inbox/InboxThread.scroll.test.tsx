import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxConversationDetail, InboxMessage, PanelApi } from '../../api'
import { InboxRealtimeProvider } from '../../realtime/InboxRealtime'
import { InboxThread } from './InboxThread'

let signal: (() => void) | null = null
vi.mock('../../realtime/InboxRealtime', async (orig) => {
  const mod = await orig<typeof import('../../realtime/InboxRealtime')>()
  return {
    ...mod,
    useInboxRealtime: (cb: (s: unknown[]) => void) => {
      signal = () => cb([{ kind: 'resync' }])
    },
  }
})

function msg(id: string, direction: 'inbound' | 'outbound', body: string): InboxMessage {
  return {
    id,
    tenantId: 't',
    conversationId: 'cnv_1',
    direction,
    body,
    externalMessageId: null,
    deliveryState: direction === 'inbound' ? 'received' : 'read',
    authorClerkUserId: null,
    authorDisplayName: null,
    createdAt: 1,
  }
}

function detail(messages: InboxMessage[], unreadCount: number): InboxConversationDetail {
  return {
    id: 'cnv_1',
    tenantId: 't',
    contactId: 'ct_1',
    status: 'open',
    assigneeClerkUserId: null,
    assigneeDisplayName: null,
    assignmentVersion: 1,
    lastMessageAt: 1,
    lastMessagePreview: '',
    lastMessageDirection: 'inbound',
    unreadCount,
    createdAt: 1,
    updatedAt: 1,
    contact: { id: 'ct_1', displayName: 'Ana', waId: '5511900000000' },
    messages,
    messagesHasMore: false,
    messagesNextBefore: null,
    messagingWindow: { open: true, lastInboundAt: 1, closesAt: null, remainingMs: null },
  } as unknown as InboxConversationDetail
}

function makeApi(responses: InboxConversationDetail[]): PanelApi {
  let i = 0
  return {
    getInboxConversation: vi.fn(async () => responses[Math.min(i++, responses.length - 1)]),
    markInboxRead: vi.fn(async () => ({ conversation: { unreadCount: 0 } })),
    listWhatsappTemplates: vi.fn(async () => ({ items: [] })),
    listConversationPixCharges: vi.fn(async () => []),
    listPixPaymentAlerts: vi.fn(async () => []),
  } as unknown as PanelApi
}

function renderThread(api: PanelApi) {
  return render(
    <InboxRealtimeProvider tenantId="t" api={api} generation={1}>
      <InboxThread
        tenantId="t"
        conversationId="cnv_1"
        api={api}
        generation={1}
        viewerClerkUserId="user_a"
      />
    </InboxRealtimeProvider>,
  )
}

describe('InboxThread — rolagem estilo WhatsApp', () => {
  afterEach(() => cleanup())

  it('abre na primeira não lida, com a faixa e o botão «↓ N»', async () => {
    const msgs = [
      msg('m1', 'inbound', 'antiga'),
      msg('m2', 'outbound', 'resposta'),
      msg('m3', 'inbound', 'nova 1'),
      msg('m4', 'inbound', 'nova 2'),
    ]
    renderThread(makeApi([detail(msgs, 2)]))
    await screen.findByText('nova 2')
    expect(screen.getByText('2 mensagens não lidas')).toBeTruthy()
    expect(screen.getByRole('button', { name: /2 não lidas/ })).toBeTruthy()
  })

  it('sem não lidas não mostra faixa nem botão', async () => {
    renderThread(makeApi([detail([msg('m1', 'inbound', 'oi')], 0)]))
    await screen.findByText('oi')
    expect(screen.queryByText(/não lida/)).toBeNull()
    expect(screen.queryByRole('button', { name: /mensagens novas/ })).toBeNull()
  })

  it('mensagem recebida com a pessoa lendo o histórico mostra «↓ 1»', async () => {
    const base = [msg('m1', 'inbound', 'antiga'), msg('m2', 'outbound', 'resposta')]
    const api = makeApi([detail(base, 0), detail([...base, msg('m3', 'inbound', 'chegou')], 1)])
    renderThread(api)
    await screen.findByText('resposta')
    const timeline = document.querySelector('.inbox-timeline') as HTMLElement
    Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(timeline, 'clientHeight', { configurable: true, value: 300 })
    timeline.scrollTop = 0
    act(() => {
      timeline.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await act(async () => {
      signal?.()
    })
    await screen.findByText('chegou')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /1 não lidas/ })).toBeTruthy(),
    )
  })
})
