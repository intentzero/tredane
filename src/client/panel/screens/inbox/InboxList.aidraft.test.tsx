// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../../ui/panel.css'
import type { InboxConversation, PanelApi } from '../../api'
import type { InboxRealtimeSignal } from '../../realtime/InboxRealtime'
import type { RealtimeServerEvent } from '../../realtime/connection'
import { applyDraftingSignals, InboxList } from './InboxList'
import { AI_DRAFTING_SR_LABEL, draftingFlagFromAiDraftState } from './aiDrafting'

vi.mock('../../badge', () => ({ applyAppBadge: () => undefined }))

function aiDraftEvent(conversationId: string, state: string): InboxRealtimeSignal {
  const event: RealtimeServerEvent = {
    type: 'event',
    seq: 1,
    eventId: `rt:ai_draft:${conversationId}:x`,
    eventType: 'conversation.ai_draft',
    entity: { type: 'conversation', id: conversationId },
    occurredAt: 1,
    payload: { conversationId, state },
  }
  return { kind: 'event', event }
}

function pauseEvent(conversationId: string, paused: boolean): InboxRealtimeSignal {
  const event: RealtimeServerEvent = {
    type: 'event',
    seq: 2,
    eventId: `rt:ai_pause:${conversationId}:x`,
    eventType: 'conversation.ai_pause',
    entity: { type: 'conversation', id: conversationId },
    occurredAt: 2,
    payload: { conversationId, aiReplyPaused: paused },
  }
  return { kind: 'event', event }
}

function conv(id: string, name: string, extra: Partial<InboxConversation> = {}): InboxConversation {
  return {
    id,
    tenantId: 't',
    contactId: `ct_${id}`,
    status: 'open',
    assigneeClerkUserId: null,
    assigneeDisplayName: null,
    assignmentVersion: 1,
    lastMessageAt: 1,
    lastMessagePreview: 'Quero agendar uma depilação?',
    lastMessageDirection: 'inbound',
    unreadCount: 2,
    createdAt: 1,
    updatedAt: 1,
    contact: { id: `ct_${id}`, displayName: name, waId: '5511900000000' },
    ...extra,
  } as unknown as InboxConversation
}

afterEach(cleanup)

describe('draftingFlagFromAiDraftState', () => {
  it('liga o spinner em queued e generating', () => {
    expect(draftingFlagFromAiDraftState('queued')).toBe(true)
    expect(draftingFlagFromAiDraftState('generating')).toBe(true)
  })

  it('desliga em outcomes terminais', () => {
    for (const state of ['ready', 'failed', 'skipped', 'superseded', 'cap_reached', 'cancelled']) {
      expect(draftingFlagFromAiDraftState(state)).toBe(false)
    }
  })

  it('ignora estados desconhecidos', () => {
    expect(draftingFlagFromAiDraftState('weird')).toBeNull()
    expect(draftingFlagFromAiDraftState(null)).toBeNull()
  })
})

describe('applyDraftingSignals', () => {
  it('marca e limpa drafting por conversation.ai_draft', () => {
    let map = applyDraftingSignals({}, [aiDraftEvent('cnv_a', 'queued')])
    expect(map).toEqual({ cnv_a: true })
    map = applyDraftingSignals(map, [aiDraftEvent('cnv_a', 'generating')])
    expect(map).toEqual({ cnv_a: true })
    map = applyDraftingSignals(map, [aiDraftEvent('cnv_a', 'ready')])
    expect(map).toEqual({ cnv_a: false })
  })

  it('pausa da IA desliga o spinner da conversa', () => {
    const map = applyDraftingSignals({ cnv_a: true }, [pauseEvent('cnv_a', true)])
    expect(map).toEqual({ cnv_a: false })
  })

  it('não muda o mapa em resync ou eventos irrelevantes', () => {
    const prev = { cnv_a: true }
    expect(applyDraftingSignals(prev, [{ kind: 'resync', reason: 'connected' }])).toBe(prev)
    expect(
      applyDraftingSignals(prev, [
        {
          kind: 'event',
          event: {
            type: 'event',
            seq: 1,
            eventId: 'x',
            eventType: 'message.created',
            entity: { type: 'message', id: 'm1' },
            occurredAt: 1,
            payload: { conversationId: 'cnv_a' },
          },
        },
      ]),
    ).toBe(prev)
  })
})

describe('InboxList — spinner IA a preparar sugestão', () => {
  it('mostra spinner e texto acessível quando aiDrafting=true', async () => {
    const api = {
      listInboxConversations: async () => ({
        conversations: [
          conv('cnv_paulo', 'Paulo', { aiDrafting: true, unreadCount: 2 }),
          conv('cnv_b', 'Bruno Lima'),
        ],
        counts: { all: 2, new: 0, mine: 0, unassigned: 2, closed: 0, unread: 2 },
      }),
    } as unknown as PanelApi

    render(<InboxList tenantId="t" api={api} generation={1} viewerClerkUserId="u" />)

    const paulo = await waitFor(() => screen.getByRole('button', { name: /Paulo/ }))
    expect(paulo.querySelector('.inbox-row-ai-spinner')).toBeTruthy()
    expect(paulo.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(paulo.textContent).toContain('IA')
    expect(paulo.textContent).toContain(AI_DRAFTING_SR_LABEL)

    const bruno = screen.getByRole('button', { name: /Bruno Lima/ })
    expect(bruno.querySelector('.inbox-row-ai')).toBeNull()
  })

  it('não mostra indicador IA sem rascunho em curso', async () => {
    const api = {
      listInboxConversations: async () => ({
        conversations: [conv('cnv_a', 'Ana Souza')],
        counts: { all: 1, new: 0, mine: 0, unassigned: 1, closed: 0, unread: 0 },
      }),
    } as unknown as PanelApi

    render(<InboxList tenantId="t" api={api} generation={1} viewerClerkUserId="u" />)
    await waitFor(() => screen.getByRole('button', { name: /Ana Souza/ }))
    expect(document.querySelector('.inbox-row-ai')).toBeNull()
    expect(screen.queryByText(AI_DRAFTING_SR_LABEL)).toBeNull()
  })
})
