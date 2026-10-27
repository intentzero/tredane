import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../../ui/panel.css'
import type { InboxConversationDetail, PanelApi } from '../../api'
import { InboxThread } from './InboxThread'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const NOW = Date.now()

function detail(blockedAt: number | null): InboxConversationDetail {
  return {
    id: 'cnv_ficticia',
    tenantId: 'clinic-demo-a',
    contactId: 'ctc_ficticio',
    status: blockedAt ? 'closed' : 'open',
    assigneeClerkUserId: 'u1',
    assigneeDisplayName: null,
    assignmentVersion: 0,
    lastMessageAt: NOW,
    lastMessagePreview: 'oi',
    lastMessageDirection: 'inbound',
    unreadCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    contact: {
      id: 'ctc_ficticio',
      waId: '5511999000111',
      displayName: 'Paulo Fictício',
      createdAt: NOW,
      blockedAt,
      blockedByDisplayName: blockedAt ? 'Ana' : null,
      blockedReason: null,
    },
    messages: [],
    messagesHasMore: false,
    messagesNextBefore: null,
    messagingWindow: { open: true, lastInboundAt: NOW, closesAt: NOW + 3_600_000, remainingMs: 3_600_000 },
  } as unknown as InboxConversationDetail
}

function mockApi(state: { blocked: boolean }): PanelApi {
  return {
    getInboxConversation: vi.fn(async () => detail(state.blocked ? NOW : null)),
    listConversationPixCharges: vi.fn(async () => []),
    listPixPaymentAlerts: vi.fn(async () => []),
    listWhatsappTemplates: vi.fn(async () => ({ items: [] })),
    markInboxRead: vi.fn(async () => ({ conversation: detail(null) })),
    getAiDraft: vi.fn(async () => ({
      job: null,
      syntheticFallback: false,
      usage: { day: '2026-10-27', drafts: 0, cap: 300, capReached: false, capReachedAt: null },
      suggestion: null,
    })),
    blockInboxContact: vi.fn(async () => {
      state.blocked = true
      return { contact: detail(NOW).contact, closedConversationIds: ['cnv_ficticia'] }
    }),
    unblockInboxContact: vi.fn(async () => {
      state.blocked = false
      return { contact: detail(null).contact }
    }),
  } as unknown as PanelApi
}

function renderThread(api: PanelApi) {
  return render(
    <InboxThread tenantId="clinic-demo-a" conversationId="cnv_ficticia" api={api} generation={1} viewerClerkUserId="u1" />,
  )
}

describe('InboxThread — bloquear contato', () => {
  it('bloqueia pelo menu ⋮ com confirmação e troca o compositor pelo aviso com «Desbloquear»', async () => {
    const state = { blocked: false }
    const api = mockApi(state)
    renderThread(api)
    expect(await screen.findByRole('textbox', { name: 'Mensagem' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções da conversa' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Bloquear contato' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Spam ou propaganda' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear contato' }))
    await waitFor(() => expect(api.blockInboxContact).toHaveBeenCalledWith(
      'clinic-demo-a',
      'ctc_ficticio',
      { reason: 'Spam ou propaganda' },
      expect.anything(),
    ))
    expect(await screen.findByText(/Contato bloqueado\./)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Mensagem' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Agendar horário' })).toBeNull()
  })

  it('contato já bloqueado: sem compositor; «Desbloquear» chama a API e devolve o compositor', async () => {
    const state = { blocked: true }
    const api = mockApi(state)
    renderThread(api)
    expect(await screen.findByText(/Contato bloqueado\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }))
    await waitFor(() => expect(api.unblockInboxContact).toHaveBeenCalled())
    expect(await screen.findByRole('textbox', { name: 'Mensagem' })).toBeTruthy()
  })

  it('menu ⋮ mantém «Reservar bloco» (M-39) ao lado de Encerrar e Bloquear; abre a reserva por bloco', async () => {
    const api = mockApi({ blocked: false })
    Object.assign(api, {
      getClinicConfig: vi.fn(() => new Promise(() => {})),
      queryAvailability: vi.fn(() => new Promise(() => {})),
    })
    renderThread(api)
    expect(await screen.findByRole('textbox', { name: 'Mensagem' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções da conversa' }))
    expect(await screen.findByRole('menuitem', { name: 'Encerrar conversa' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Bloquear contato' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reservar bloco' }))
    await waitFor(() => expect(api.getClinicConfig).toHaveBeenCalled())
  })

  it('contato bloqueado: menu ⋮ sem «Reservar bloco», só «Desbloquear contato»', async () => {
    const api = mockApi({ blocked: true })
    renderThread(api)
    expect(await screen.findByText(/Contato bloqueado\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções da conversa' }))
    expect(await screen.findByRole('menuitem', { name: 'Desbloquear contato' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Reservar bloco' })).toBeNull()
  })
})
