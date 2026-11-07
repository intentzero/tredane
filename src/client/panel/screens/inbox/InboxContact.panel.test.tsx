import userEvent from '@testing-library/user-event'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import { InboxContactScreen } from './InboxContact'

afterEach(() => {
  cleanup()
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
const conv = (id: string, status: 'new' | 'open' | 'closed', assignee: string | null) => ({
  id,
  tenantId: 't',
  contactId: contact.id,
  status,
  assigneeClerkUserId: assignee ? 'u1' : null,
  assigneeDisplayName: assignee,
  assignmentVersion: 1,
  lastMessageAt: NOW,
  lastMessagePreview: 'Olá',
  lastMessageDirection: 'inbound' as const,
  unreadCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
  contact,
})

function renderPanel(detail: Record<string, unknown>) {
  const api = { getInboxContact: vi.fn(async () => ({ contact, ...detail })) } as unknown as PanelApi
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
}

describe('InboxContact — painel simplificado', () => {
  it('mostra identidade, situação e oculta o telefone até pedir', async () => {
    renderPanel({ conversations: [conv('c1', 'open', 'Ana')], appointments: { upcoming: [], past: [] } })
    expect(await screen.findByRole('heading', { name: 'Mariana Fictícia' })).toBeTruthy()
    expect(screen.getByText(/9••••-4821/)).toBeTruthy()
    expect(screen.getByText('Ana')).toBeTruthy()
    expect(screen.getByText('Nenhum marcado')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Mostrar telefone' }))
    expect(screen.getByText('+55 11 98765-4821')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ocultar telefone' })).toBeTruthy()
  })

  it('não repete a conversa aberta e esconde seções vazias', async () => {
    renderPanel({
      conversations: [conv('c1', 'open', null), conv('c0', 'closed', 'Bia')],
      appointments: { upcoming: [], past: [] },
    })
    await screen.findByRole('heading', { name: 'Mariana Fictícia' })
    expect(screen.getByRole('heading', { name: 'Outras conversas' })).toBeTruthy()
    expect(screen.getAllByText('Em atendimento')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Horários' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Acompanhamento' })).toBeNull()
    expect(screen.getByText('Ninguém assumiu')).toBeTruthy()
  })

  it('só pede os horários anteriores quando a atendente quer ver', async () => {
    const appt = (id: string) => ({
      id,
      startsAt: NOW + 86_400_000,
      endsAt: NOW + 90_000_000,
      serviceName: 'Drenagem linfática',
      status: 'confirmed',
      professionalName: 'Bia',
      roomResourceName: null,
      changeReason: null,
    })
    renderPanel({
      conversations: [conv('c1', 'open', 'Ana')],
      appointments: { upcoming: [appt('a1')], past: [appt('a0')] },
    })
    await screen.findByRole('heading', { name: 'Mariana Fictícia' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Ver 1 anterior' }))
    expect(screen.getByRole('heading', { name: 'Anteriores' })).toBeTruthy()
  })
})
