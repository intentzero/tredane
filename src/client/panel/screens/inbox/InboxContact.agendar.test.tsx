import userEvent from '@testing-library/user-event'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import { consumeAgendarOpen, requestAgendarOpen } from './agendarFocus'
import { InboxContactScreen } from './InboxContact'

const navigatePanel = vi.fn()
vi.mock('../../routes', () => ({
  navigatePanel: (...a: unknown[]) => navigatePanel(...a),
}))

afterEach(() => {
  cleanup()
  navigatePanel.mockReset()
  // Limpa pedido pendente entre casos.
  consumeAgendarOpen()
  vi.restoreAllMocks()
})

const NOW = Date.now()
const contact = {
  id: 'ctc_ficticio',
  waId: '5511987654821',
  displayName: 'Mariana Fictícia',
  createdAt: NOW,
  blockedAt: null,
  blockedByDisplayName: null,
  blockedReason: null,
}

function detail() {
  return {
    contact,
    conversations: [
      {
        id: 'c1',
        tenantId: 't',
        contactId: contact.id,
        status: 'open' as const,
        assigneeClerkUserId: 'u1',
        assigneeDisplayName: 'Ana',
        assignmentVersion: 1,
        lastMessageAt: NOW,
        lastMessagePreview: 'Olá',
        lastMessageDirection: 'inbound' as const,
        unreadCount: 0,
        createdAt: NOW,
        updatedAt: NOW,
        contact,
      },
    ],
    appointments: { upcoming: [], past: [] },
  }
}

describe('InboxContact — Agendar no contexto da conversa (DEC-162)', () => {
  it('com onAgendar (painel da conversa): chama o fluxo in-context e não vai à Agenda', async () => {
    const onAgendar = vi.fn()
    const api = { getInboxContact: vi.fn(async () => detail()) } as unknown as PanelApi
    render(
      <InboxContactScreen
        tenantId="t"
        contactId={contact.id}
        conversationId="c1"
        api={api}
        generation={1}
        isOwner={false}
        onAgendar={onAgendar}
      />,
    )
    await screen.findByRole('heading', { name: 'Mariana Fictícia' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Agendar' }))
    expect(onAgendar).toHaveBeenCalledTimes(1)
    expect(navigatePanel).not.toHaveBeenCalled()
  })

  it('Contato focado a partir da conversa: volta à thread e pede o Agendar in-context', async () => {
    const api = { getInboxContact: vi.fn(async () => detail()) } as unknown as PanelApi
    render(
      <InboxContactScreen
        tenantId="t"
        contactId={contact.id}
        conversationId="c1"
        api={api}
        generation={1}
        isOwner={false}
      />,
    )
    await screen.findByRole('heading', { name: 'Mariana Fictícia' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Agendar' }))
    expect(navigatePanel).toHaveBeenCalledWith({
      kind: 'area',
      area: 'conversas',
      tenantId: 't',
      section: 'thread',
      conversationId: 'c1',
    })
    expect(consumeAgendarOpen()).toBe(true)
  })

  it('origem Clientes: Agendar continua a ir para a área Agenda', async () => {
    const api = { getInboxContact: vi.fn(async () => detail()) } as unknown as PanelApi
    render(
      <InboxContactScreen
        tenantId="t"
        contactId={contact.id}
        api={api}
        generation={1}
        isOwner={false}
        origin="clientes"
      />,
    )
    await screen.findByRole('heading', { name: 'Mariana Fictícia' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Agendar' }))
    expect(navigatePanel).toHaveBeenCalledWith({
      kind: 'area',
      area: 'agenda',
      tenantId: 't',
      section: 'agendar',
      contactId: contact.id,
      conversationId: 'c1',
    })
    expect(consumeAgendarOpen()).toBe(false)
  })

  it('request/consume do Agendar é one-shot', () => {
    requestAgendarOpen()
    expect(consumeAgendarOpen()).toBe(true)
    expect(consumeAgendarOpen()).toBe(false)
  })
})
