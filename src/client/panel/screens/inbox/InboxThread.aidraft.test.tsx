import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../../ui/panel.css'
import type { AiDraftState, InboxConversationDetail, PanelApi } from '../../api'
import { InboxThread } from './InboxThread'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const NOW = Date.now()
const TEXT = 'Oi, Paulo! Amanhã à tarde tenho 13:00, 15:00 ou 16:00. Qual fica melhor?'

function detail(): InboxConversationDetail {
  return {
    id: 'cnv_ficticia',
    tenantId: 'clinic-demo-a',
    contactId: 'ctc_ficticio',
    status: 'open',
    assigneeClerkUserId: 'u1',
    assigneeDisplayName: null,
    assignmentVersion: 0,
    lastMessageAt: NOW,
    lastMessagePreview: 'Amanhã',
    lastMessageDirection: 'inbound',
    unreadCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    contact: { id: 'ctc_ficticio', waId: '5511999000111', displayName: 'Paulo Fictício' },
    messages: [
      {
        id: 'msg_in',
        tenantId: 'clinic-demo-a',
        conversationId: 'cnv_ficticia',
        direction: 'inbound',
        body: 'Amanhã na parte da tarde, tem algum horário?',
        externalMessageId: null,
        deliveryState: 'received',
        authorClerkUserId: null,
        authorDisplayName: null,
        createdAt: NOW,
        readByDisplayName: 'Ana',
        readAt: NOW,
      },
    ],
    messagesHasMore: false,
    messagesNextBefore: null,
    messagingWindow: { open: true, lastInboundAt: NOW, closesAt: NOW + 3_600_000, remainingMs: 3_600_000 },
  } as unknown as InboxConversationDetail
}

function draftState(): AiDraftState {
  return {
    job: null,
    syntheticFallback: true,
    usage: { day: '2026-10-27', drafts: 1, cap: 300, capReached: false, capReachedAt: null },
    suggestion: {
      id: 'sug_auto',
      conversationId: 'cnv_ficticia',
      kind: 'reply',
      status: 'pending',
      provider: 'synthetic',
      model: 'claude-haiku-5-5',
      suggestedText: TEXT,
      warningCodes: [],
      warningLabels: [],
      sourceRefs: [],
      requestMeta: { latencyMs: 1, inputTokens: 1, outputTokens: 1, messageCount: 1, mode: 'synthetic' },
      errorCode: null,
      createdAt: NOW,
      messageSent: false,
      origin: 'auto',
      replyToMessageId: 'msg_in',
      internalNotes: 'Depilação masculina dura 60 min.',
    },
  }
}

function mockApi(): PanelApi {
  const d = detail()
  return {
    getInboxConversation: vi.fn(async () => d),
    listConversationPixCharges: vi.fn(async () => []),
    listPixPaymentAlerts: vi.fn(async () => []),
    listWhatsappTemplates: vi.fn(async () => ({ items: [] })),
    markInboxRead: vi.fn(async () => ({ conversation: d })),
    getAiDraft: vi.fn(async () => draftState()),
  } as unknown as PanelApi
}

describe('InboxThread — rascunho automático da IA', () => {
  it('compositor vazio: insere o rascunho (texto limpo); notas ficam à parte; aviso de modo de teste; «Lida por»', async () => {
    render(
      <InboxThread tenantId="clinic-demo-a" conversationId="cnv_ficticia" api={mockApi()} generation={1} viewerClerkUserId="u1" />,
    )
    const box = (await screen.findByRole('textbox', { name: 'Mensagem' })) as HTMLTextAreaElement
    await waitFor(() => expect(box.value).toBe(TEXT), { timeout: 3000 })
    expect(box.value).not.toContain('60 min')
    expect(screen.getByText('Depilação masculina dura 60 min.')).toBeTruthy()
    expect(screen.getByText(/IA em modo de teste/)).toBeTruthy()
    expect(screen.getByText(/Lida por Ana/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gerar outra' })).toBeTruthy()
  })
})
