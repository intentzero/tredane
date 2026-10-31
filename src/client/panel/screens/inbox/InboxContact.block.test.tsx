import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import { InboxContactScreen } from './InboxContact'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const NOW = Date.now()

function contact(blockedAt: number | null = null) {
  return {
    id: 'ctc_ficticio',
    waId: '5511999000111',
    displayName: 'Paulo Fictício',
    createdAt: NOW,
    blockedAt,
    blockedByDisplayName: blockedAt ? 'Ana' : null,
    blockedReason: null,
  }
}

function renderContact(opts: { hasPendingPix?: boolean; blocked?: boolean } = {}) {
  const state = { blocked: opts.blocked === true }
  const api = {
    getInboxContact: vi.fn(async () => ({
      contact: contact(state.blocked ? NOW : null),
      conversations: [],
      hasPendingPix: opts.hasPendingPix === true,
    })),
    blockInboxContact: vi.fn(async () => {
      state.blocked = true
      return { contact: contact(NOW), closedConversationIds: ['cnv1'] }
    }),
    unblockInboxContact: vi.fn(async () => {
      state.blocked = false
      return { contact: contact(null) }
    }),
  } as unknown as PanelApi

  render(
    <InboxContactScreen
      tenantId="clinic-demo-a"
      contactId="ctc_ficticio"
      conversationId="cnv1"
      api={api}
      generation={1}
      isOwner
    />,
  )
  return { api, state }
}

describe('InboxContact — Bloquear (única entrada, Opção A)', () => {
  const PIX = 'Este contato tem um Pix pendente. O Pix continua válido e não será cancelado.'

  it('bloqueia pelo Contato com confirmação', async () => {
    const { api } = renderContact()
    fireEvent.click(await screen.findByRole('button', { name: 'Bloquear contato' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Spam ou propaganda' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear contato' }))
    await waitFor(() =>
      expect(api.blockInboxContact).toHaveBeenCalledWith(
        'clinic-demo-a',
        'ctc_ficticio',
        { reason: 'Spam ou propaganda' },
        expect.anything(),
      ),
    )
  })

  it('com Pix pendente o diálogo avisa antes; sem Pix não', async () => {
    renderContact({ hasPendingPix: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Bloquear contato' }))
    expect(await screen.findByText(PIX)).toBeTruthy()
    cleanup()
    renderContact({ hasPendingPix: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Bloquear contato' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(screen.queryByText(PIX)).toBeNull()
  })

  it('mostra Resumo da IA na ficha (casa única)', async () => {
    renderContact()
    expect(await screen.findByRole('heading', { name: 'Resumo da IA' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gerar resumo' })).toBeTruthy()
  })
})
