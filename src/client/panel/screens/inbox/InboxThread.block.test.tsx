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
    getTeamMembers: vi.fn(async () => ({
      members: [
        { clerkUserId: 'u1', role: 'attendant', status: 'active' },
        { clerkUserId: 'u2', role: 'owner', status: 'active' },
        { clerkUserId: 'u3', role: 'attendant', status: 'revoked' },
      ],
    })),
    assignInboxConversation: vi.fn(async (_t: string, _c: string, body: { assigneeClerkUserId: string; assigneeDisplayName: string }) => ({
      conversation: { ...detail(null), assigneeClerkUserId: body.assigneeClerkUserId, assigneeDisplayName: body.assigneeDisplayName },
      systemMessage: { id: 'sys1', tenantId: 'clinic-demo-a', conversationId: 'cnv_ficticia', direction: 'system', body: 'transferiu', externalMessageId: null, deliveryState: 'received', authorClerkUserId: 'u1', authorDisplayName: 'Ana', createdAt: NOW },
      versionMatched: true,
    })),
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

  it('Transferir: lista só membros ativos (sem você) e atribui à pessoa escolhida', async () => {
    const api = mockApi({ blocked: false })
    renderThread(api)
    await screen.findByRole('textbox', { name: 'Mensagem' })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções da conversa' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Transferir para outra pessoa' }))
    const pick = await screen.findByRole('button', { name: 'Responsável' })
    expect(screen.queryByRole('button', { name: /Atendente/ })).toBeNull()
    fireEvent.click(pick)
    await waitFor(() =>
      expect(api.assignInboxConversation).toHaveBeenCalledWith(
        'clinic-demo-a',
        'cnv_ficticia',
        { assigneeClerkUserId: 'u2', assigneeDisplayName: 'Responsável', expectedAssignmentVersion: 0 },
        expect.anything(),
      ),
    )
  })

  it('celular: o ⋮ abre a folha de ações com Ver detalhes, Reservar bloco, Transferir, Encerrar e Bloquear', async () => {
    const mm = vi.fn((q: string) => ({
      matches: q.includes('max-width: 767'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    vi.stubGlobal('matchMedia', mm)
    try {
      renderThread(mockApi({ blocked: false }))
      await screen.findByRole('textbox', { name: 'Mensagem' })
      fireEvent.click(screen.getByRole('button', { name: 'Mais opções da conversa' }))
      const sheet = await screen.findByRole('dialog', { name: /Conversa com/ })
      for (const name of ['Ver detalhes do contato', 'Reservar bloco', 'Transferir para outra pessoa', 'Encerrar conversa', 'Bloquear contato']) {
        expect(Array.from(sheet.querySelectorAll('button')).some((b) => b.textContent === name)).toBe(true)
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

function msg(id: string, direction: 'inbound' | 'outbound' | 'system', at: number) {
  return {
    id,
    tenantId: 'clinic-demo-a',
    conversationId: 'cnv_ficticia',
    direction,
    body: direction === 'system' ? 'Nota interna da equipe' : `texto ${id}`,
    externalMessageId: null,
    deliveryState: 'delivered',
    authorClerkUserId: direction === 'inbound' ? null : 'u1',
    authorDisplayName: direction === 'inbound' ? null : 'Ana',
    createdAt: at,
  }
}

function withMessages(api: PanelApi, messages: ReturnType<typeof msg>[], extra: Record<string, unknown> = {}) {
  Object.assign(api, {
    getInboxConversation: vi.fn(async () => ({ ...detail(null), messages, ...extra })),
  })
  return api
}

describe('InboxThread — «Sugerir resposta» só com a cliente à espera (Decidido)', () => {
  const T = NOW - 3_600_000
  it('última mensagem da cliente: mostra «Sugerir resposta»', async () => {
    renderThread(withMessages(mockApi({ blocked: false }), [msg('a', 'inbound', T)]))
    expect(await screen.findByRole('button', { name: 'Sugerir resposta com IA' })).toBeTruthy()
  })

  it('última mensagem da clínica (cliente 18:06–18:07, resposta 19:12): esconde', async () => {
    renderThread(
      withMessages(mockApi({ blocked: false }), [
        msg('a', 'inbound', T),
        msg('b', 'inbound', T + 60_000),
        msg('c', 'outbound', T + 66 * 60_000),
      ]),
    )
    expect(await screen.findByRole('textbox', { name: 'Mensagem' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sugerir resposta com IA' })).toBeNull()
  })

  it('nota interna/sistema depois da mensagem da cliente: continua a mostrar', async () => {
    renderThread(
      withMessages(mockApi({ blocked: false }), [msg('a', 'inbound', T), msg('s', 'system', T + 1000)]),
    )
    expect(await screen.findByRole('button', { name: 'Sugerir resposta com IA' })).toBeTruthy()
  })

  it('nota interna/sistema depois da nossa resposta: continua escondido', async () => {
    renderThread(
      withMessages(mockApi({ blocked: false }), [
        msg('a', 'inbound', T),
        msg('c', 'outbound', T + 1000),
        msg('s', 'system', T + 2000),
      ]),
    )
    expect(await screen.findByRole('textbox', { name: 'Mensagem' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sugerir resposta com IA' })).toBeNull()
  })

  it('sugestão automática pendente não é inserida quando a última é nossa', async () => {
    const api = withMessages(mockApi({ blocked: false }), [msg('a', 'inbound', T), msg('c', 'outbound', T + 1000)])
    Object.assign(api, {
      getAiDraft: vi.fn(async () => ({
        job: null,
        syntheticFallback: false,
        usage: { day: '2026-10-27', drafts: 1, cap: 300, capReached: false, capReachedAt: null },
        suggestion: { id: 'sg1', origin: 'auto', status: 'pending', suggestedText: 'Rascunho automático', replyToMessageId: 'a' },
      })),
    })
    renderThread(api)
    const box = (await screen.findByRole('textbox', { name: 'Mensagem' })) as HTMLTextAreaElement
    await waitFor(() => expect(api.getAiDraft).toHaveBeenCalled())
    expect(box.value).toBe('')
    expect(screen.queryByRole('button', { name: /Sugestão pronta/ })).toBeNull()
  })
})

describe('InboxThread — bloquear com Pix pendente (Decidido)', () => {
  const PIX = 'Este contato tem um Pix pendente. O Pix continua válido e não será cancelado.'
  it('com Pix pendente o diálogo avisa antes de confirmar; sem Pix não', async () => {
    const api = withMessages(mockApi({ blocked: false }), [], { contactHasPendingPix: true })
    renderThread(api)
    expect(await screen.findByRole('textbox', { name: 'Mensagem' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções da conversa' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Bloquear contato' }))
    expect(await screen.findByText(PIX)).toBeTruthy()
    cleanup()
    renderThread(mockApi({ blocked: false }))
    expect(await screen.findByRole('textbox', { name: 'Mensagem' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções da conversa' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Bloquear contato' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(screen.queryByText(PIX)).toBeNull()
  })
})
