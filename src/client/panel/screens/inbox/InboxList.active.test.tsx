// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxConversation, PanelApi } from '../../api'
import { InboxList } from './InboxList'

vi.mock('../../badge', () => ({ applyAppBadge: () => undefined }))

function conv(id: string, name: string): InboxConversation {
  return {
    id,
    tenantId: 't',
    contactId: `ct_${id}`,
    status: 'open',
    assigneeClerkUserId: null,
    assigneeDisplayName: null,
    assignmentVersion: 1,
    lastMessageAt: 1,
    lastMessagePreview: 'Oi',
    lastMessageDirection: 'inbound',
    unreadCount: 0,
    createdAt: 1,
    updatedAt: 1,
    contact: { id: `ct_${id}`, displayName: name, waId: '5511900000000' },
  } as unknown as InboxConversation
}

const api = {
  listInboxConversations: async () => ({
    conversations: [conv('cnv_a', 'Ana Souza'), conv('cnv_b', 'Bruno Lima')],
    counts: { all: 2, new: 0, mine: 0, unassigned: 2, closed: 0, unread: 0 },
  }),
} as unknown as PanelApi

afterEach(cleanup)

describe('InboxList — conversa aberta', () => {
  it('marca só a linha da conversa aberta com aria-current="page"', async () => {
    render(
      <InboxList
        tenantId="t"
        api={api}
        generation={1}
        viewerClerkUserId="u"
        activeConversationId="cnv_b"
      />,
    )
    const bruno = await waitFor(() => screen.getByRole('button', { name: /Bruno Lima/ }))
    const ana = screen.getByRole('button', { name: /Ana Souza/ })
    expect(bruno.getAttribute('aria-current')).toBe('page')
    expect(bruno.className).toContain('inbox-row--active')
    expect(ana.getAttribute('aria-current')).toBeNull()
  })

  it('sem conversa aberta nenhuma linha fica marcada', async () => {
    render(<InboxList tenantId="t" api={api} generation={1} viewerClerkUserId="u" />)
    await waitFor(() => screen.getByRole('button', { name: /Bruno Lima/ }))
    expect(document.querySelector('[aria-current="page"]')).toBeNull()
  })
})
