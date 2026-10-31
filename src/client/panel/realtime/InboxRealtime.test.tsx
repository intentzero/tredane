import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxConversationDetail, PanelApi } from '../api'
import { InboxThread } from '../screens/inbox/InboxThread'
import {
  eventDeletesConversation,
  InboxRealtimeProvider,
  isScheduleEvent,
} from './InboxRealtime'

class StubWebSocket {
  static all: StubWebSocket[] = []
  readyState = 0
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(readonly url: string) {
    StubWebSocket.all.push(this)
  }
  send() {}
  close() {}
  push(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

function detail(body: string): InboxConversationDetail {
  return {
    id: 'cnv_1',
    tenantId: 'clinic-demo-a',
    contactId: 'ct_1',
    status: 'open',
    assigneeClerkUserId: null,
    assigneeDisplayName: null,
    assignmentVersion: 1,
    lastMessageAt: 1,
    lastMessagePreview: body,
    lastMessageDirection: 'inbound',
    unreadCount: 0,
    createdAt: 1,
    updatedAt: 1,
    contact: { id: 'ct_1', displayName: 'Ana', waId: '5511900000000' },
    messages: [
      {
        id: `msg_${body}`,
        tenantId: 'clinic-demo-a',
        conversationId: 'cnv_1',
        direction: 'inbound',
        body,
        externalMessageId: null,
        deliveryState: 'received',
        authorClerkUserId: null,
        createdAt: 1,
      },
    ],
    messagesHasMore: false,
    messagesNextBefore: null,
    messagingWindow: { open: true, lastInboundAt: 1, closesAt: null, remainingMs: null },
  } as unknown as InboxConversationDetail
}

describe('helpers contact.deleted / agenda', () => {
  it('eventDeletesConversation reconhece conversationIds no payload', () => {
    expect(
      eventDeletesConversation(
        {
          v: 1,
          type: 'event',
          seq: 1,
          eventId: 'e',
          eventType: 'contact.deleted',
          entity: { type: 'contact', id: 'ct_1' },
          occurredAt: 1,
          payload: { contactId: 'ct_1', conversationIds: ['cnv_1', 'cnv_2'] },
        },
        'cnv_2',
      ),
    ).toBe(true)
    expect(
      eventDeletesConversation(
        {
          v: 1,
          type: 'event',
          seq: 1,
          eventId: 'e',
          eventType: 'contact.deleted',
          entity: { type: 'contact', id: 'ct_1' },
          occurredAt: 1,
          payload: { contactId: 'ct_1', conversationIds: ['cnv_1'] },
        },
        'cnv_other',
      ),
    ).toBe(false)
  })

  it('isScheduleEvent inclui contact.deleted (anonimiza agenda)', () => {
    expect(
      isScheduleEvent({
        v: 1,
        type: 'event',
        seq: 1,
        eventId: 'e',
        eventType: 'contact.deleted',
        entity: { type: 'contact', id: 'ct_1' },
        occurredAt: 1,
        payload: { contactId: 'ct_1' },
      }),
    ).toBe(true)
  })
})

describe('InboxRealtimeProvider + InboxThread', () => {
  beforeEach(() => {
    StubWebSocket.all = []
    vi.stubGlobal('WebSocket', StubWebSocket)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('evento da conversa aberta refaz o fetch sem perder o rascunho', async () => {
    let n = 0
    const getInboxConversation = vi.fn(async () => detail(n++ === 0 ? 'primeira' : 'segunda'))
    const api = {
      getRealtimeTicket: vi.fn(async () => ({ ticket: 'wst_t', expiresAt: 0 })),
      getInboxConversation,
      markInboxRead: vi.fn(),
      listWhatsappTemplates: vi.fn(async () => ({ items: [] })),
      listConversationPixCharges: vi.fn(async () => []),
      listPixPaymentAlerts: vi.fn(async () => []),
    } as unknown as PanelApi

    render(
      <InboxRealtimeProvider tenantId="clinic-demo-a" api={api} generation={1}>
        <InboxThread
          tenantId="clinic-demo-a"
          conversationId="cnv_1"
          api={api}
          generation={1}
          viewerClerkUserId="user_a"
        />
      </InboxRealtimeProvider>,
    )

    await screen.findByText('primeira')
    await waitFor(() => expect(StubWebSocket.all).toHaveLength(1))
    expect(StubWebSocket.all[0]!.url).toContain('/api/tenants/clinic-demo-a/ws?ticket=wst_t')

    const composer = screen.getByRole('textbox')
    await userEvent.type(composer, 'rascunho em curso')

    act(() => {
      StubWebSocket.all[0]!.push({ v: 1, type: 'hello', connectionId: 'ws_1' })
    })
    act(() => {
      StubWebSocket.all[0]!.push({
        v: 1,
        type: 'event',
        seq: 2,
        eventId: 'evt_1',
        eventType: 'message.created',
        entity: { type: 'message', id: 'msg_2' },
        occurredAt: 2,
        payload: { conversationId: 'cnv_1', direction: 'inbound' },
      })
    })

    await screen.findByText('segunda')
    expect(getInboxConversation.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('rascunho em curso')
  })

  it('evento de outra conversa não refaz o fetch da conversa aberta', async () => {
    const getInboxConversation = vi.fn(async () => detail('primeira'))
    const api = {
      getRealtimeTicket: vi.fn(async () => ({ ticket: 'wst_t', expiresAt: 0 })),
      getInboxConversation,
      markInboxRead: vi.fn(),
      listWhatsappTemplates: vi.fn(async () => ({ items: [] })),
      listConversationPixCharges: vi.fn(async () => []),
      listPixPaymentAlerts: vi.fn(async () => []),
    } as unknown as PanelApi
    render(
      <InboxRealtimeProvider tenantId="clinic-demo-a" api={api} generation={1}>
        <InboxThread
          tenantId="clinic-demo-a"
          conversationId="cnv_1"
          api={api}
          generation={1}
          viewerClerkUserId="user_a"
        />
      </InboxRealtimeProvider>,
    )
    await screen.findByText('primeira')
    await waitFor(() => expect(StubWebSocket.all).toHaveLength(1))
    const callsBefore = getInboxConversation.mock.calls.length
    act(() => {
      StubWebSocket.all[0]!.push({
        v: 1,
        type: 'event',
        seq: 3,
        eventId: 'evt_2',
        eventType: 'message.created',
        entity: { type: 'message', id: 'msg_9' },
        occurredAt: 3,
        payload: { conversationId: 'cnv_other' },
      })
    })
    await new Promise((r) => setTimeout(r, 300))
    expect(getInboxConversation.mock.calls.length).toBe(callsBefore)
  })

  it('contact.deleted com conversationIds limpa a thread aberta (AC-52)', async () => {
    const getInboxConversation = vi.fn(async () => detail('antes'))
    const api = {
      getRealtimeTicket: vi.fn(async () => ({ ticket: 'wst_t', expiresAt: 0 })),
      getInboxConversation,
      markInboxRead: vi.fn(),
      listWhatsappTemplates: vi.fn(async () => ({ items: [] })),
      listConversationPixCharges: vi.fn(async () => []),
      listPixPaymentAlerts: vi.fn(async () => []),
    } as unknown as PanelApi
    render(
      <InboxRealtimeProvider tenantId="clinic-demo-a" api={api} generation={1}>
        <InboxThread
          tenantId="clinic-demo-a"
          conversationId="cnv_1"
          api={api}
          generation={1}
          viewerClerkUserId="user_a"
        />
      </InboxRealtimeProvider>,
    )
    await screen.findByText('antes')
    await waitFor(() => expect(StubWebSocket.all).toHaveLength(1))
    act(() => {
      StubWebSocket.all[0]!.push({
        v: 1,
        type: 'event',
        seq: 9,
        eventId: 'evt_del',
        eventType: 'contact.deleted',
        entity: { type: 'contact', id: 'ct_1' },
        occurredAt: 9,
        payload: { contactId: 'ct_1', conversationIds: ['cnv_1'] },
      })
    })
    await screen.findByText(/Este contato foi excluído/)
    expect(screen.queryByText('antes')).toBeNull()
  })
})
