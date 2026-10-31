import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import { InboxContactScreen } from './InboxContact'
import { InboxThread } from './InboxThread'

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

describe('Resumo da IA — só no Contato (Opção A)', () => {
  it('menu ⋮ não tem «Resumo da IA»; a ficha Contato tem Gerar resumo', async () => {
    render(<InboxThread tenantId="t" conversationId="cnv1" api={api} generation={1} viewerClerkUserId="u1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mais opções da conversa' }))
    expect(await screen.findByRole('menuitem', { name: 'Encerrar conversa' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Resumo da IA' })).toBeNull()
    cleanup()
    render(<InboxContactScreen tenantId="t" contactId="ctc1" conversationId="cnv1" api={api} generation={1} isOwner />)
    expect(await screen.findByRole('heading', { name: 'Resumo da IA' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gerar resumo' })).toBeTruthy()
  })
})
