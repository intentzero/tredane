import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import { InboxContactScreen } from './InboxContact'
import { InboxThread } from './InboxThread'
import { consumeSummaryFocus } from './summaryFocus'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const NOW = Date.now()
const contact = { id: 'ctc1', waId: '5511999000111', displayName: 'Paulo', createdAt: NOW }
const conv = {
  id: 'cnv1', tenantId: 't', contactId: 'ctc1', status: 'open', assigneeClerkUserId: 'u1',
  assigneeDisplayName: null, assignmentVersion: 0, lastMessageAt: NOW, lastMessagePreview: 'Oi',
  lastMessageDirection: 'inbound', unreadCount: 0, createdAt: NOW, updatedAt: NOW, contact,
}
const detail = {
  ...conv,
  messages: [{ id: 'm1', tenantId: 't', conversationId: 'cnv1', direction: 'inbound', body: 'Oi', externalMessageId: null, deliveryState: 'received', authorClerkUserId: null, authorDisplayName: null, createdAt: NOW, readByDisplayName: null, readAt: null }],
  messagesHasMore: false, messagesNextBefore: null,
  messagingWindow: { open: true, lastInboundAt: NOW, closesAt: NOW + 3_600_000, remainingMs: 3_600_000 },
}
const impl: Record<string, unknown> = {
  getInboxConversation: async () => detail,
  getInboxContact: async () => ({ contact, conversations: [conv] }),
  getAiDraft: async () => ({ job: null, suggestion: null }),
  listWhatsappTemplates: async () => ({ items: [] }),
  markInboxRead: async () => ({ conversation: conv }),
}
const api = new Proxy(impl, {
  get: (t, k: string) => t[k] ?? (async () => (/Pix|Alerts|Charges/.test(k) ? [] : { items: [] })),
}) as unknown as PanelApi

describe('Resumo da IA no celular', () => {
  it('o menu ⋮ da conversa tem «Resumo da IA» e leva à ficha focada no resumo', async () => {
    render(<InboxThread tenantId="t" conversationId="cnv1" api={api} generation={1} viewerClerkUserId="u1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mais opções da conversa' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Resumo da IA' }))
    cleanup()
    render(<InboxContactScreen tenantId="t" contactId="ctc1" conversationId="cnv1" api={api} generation={1} isOwner />)
    const h = await screen.findByRole('heading', { name: 'Resumo da IA' })
    expect(document.activeElement).toBe(h)
    expect(screen.getByRole('button', { name: 'Gerar resumo' })).toBeTruthy()
    expect(consumeSummaryFocus()).toBe(false)
  })
})
