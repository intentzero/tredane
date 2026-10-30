import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    // Nota da IA: recolhida; abre sob demanda e nunca vai no texto do compositor.
    expect(screen.queryByText('Depilação masculina dura 60 min.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Nota da IA para você' }))
    expect(screen.getByText('Depilação masculina dura 60 min.')).toBeTruthy()
    expect(screen.getByText(/IA em modo de teste/)).toBeTruthy()
    expect(screen.getByText(/Lida por Ana/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gerar outra' })).toBeTruthy()
  })

  it('esconde «Sugerir resposta» enquanto a IA escreve o rascunho', async () => {
    const api = mockApi()
    api.getAiDraft = vi.fn(async () => ({
      job: { state: 'generating' as const, messageId: 'msg_in', dueAt: NOW },
      syntheticFallback: false,
      usage: { day: '2026-10-27', drafts: 0, cap: 300, capReached: false, capReachedAt: null },
      suggestion: null,
    }))
    render(
      <InboxThread tenantId="clinic-demo-a" conversationId="cnv_ficticia" api={api} generation={1} viewerClerkUserId="u1" />,
    )
    expect(await screen.findByText(/IA escrevendo um rascunho/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sugerir resposta com IA' })).toBeNull()
  })

  it('rascunho vira cartão de largura total: Outra, Nota, Enviar, tela cheia e descartar', async () => {
    render(
      <InboxThread tenantId="clinic-demo-a" conversationId="cnv_ficticia" api={mockApi()} generation={1} viewerClerkUserId="u1" />,
    )
    const box = (await screen.findByRole('textbox', { name: 'Mensagem' })) as HTMLTextAreaElement
    await waitFor(() => expect(box.value).toBe(TEXT), { timeout: 3000 })
    expect(screen.getByText(/revise antes de enviar/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver rascunho em tela cheia' }))
    expect(await screen.findByRole('textbox', { name: 'Resposta' })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Voltar para a conversa' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Descartar rascunho' }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Mensagem' }) as HTMLTextAreaElement).value).toBe(''))
  })
})
