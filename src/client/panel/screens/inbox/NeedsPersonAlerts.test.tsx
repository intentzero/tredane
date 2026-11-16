// @vitest-environment jsdom
/**
 * DEC-156 A+E — faixa no shell + título do separador.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import { NeedsPersonAlerts } from './NeedsPersonAlerts'

vi.mock('../../pwa', () => ({
  isPushSupported: () => false,
  subscribePush: async () => undefined,
}))

function makeApi(opts: {
  needsPerson: number
  firstId?: string | null
}): PanelApi {
  return {
    listInboxConversations: async () => ({
      conversations:
        opts.needsPerson > 0 && opts.firstId
          ? [
              {
                id: opts.firstId,
                tenantId: 't',
                contactId: 'ct_1',
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
                contact: {
                  id: 'ct_1',
                  displayName: 'Paulo',
                  waId: '5511900000000',
                },
              },
            ]
          : [],
      counts: {
        all: 1,
        new: 0,
        mine: 0,
        unassigned: 1,
        closed: 0,
        unread: 0,
        needsPerson: opts.needsPerson,
      },
    }),
  } as unknown as PanelApi
}

afterEach(() => {
  cleanup()
  document.title = 'Tredane | Atendimento inteligente'
})

beforeEach(() => {
  document.title = 'Tredane | Atendimento inteligente'
})

describe('NeedsPersonAlerts — shell A+E', () => {
  it('mostra faixa e altera o título do separador com needsPerson > 0', async () => {
    render(
      <NeedsPersonAlerts
        tenantId="t"
        api={makeApi({ needsPerson: 1, firstId: 'cnv_1' })}
        generation={1}
      />,
    )
    await waitFor(() =>
      expect(screen.getByTestId('needs-person-strip')).toBeTruthy(),
    )
    expect(document.title).toBe('Precisa de alguém · Tredane')
  })

  it('usa contagem no título quando N > 1', async () => {
    render(
      <NeedsPersonAlerts
        tenantId="t"
        api={makeApi({ needsPerson: 3, firstId: 'cnv_1' })}
        generation={1}
      />,
    )
    await waitFor(() =>
      expect(screen.getByTestId('needs-person-strip')).toBeTruthy(),
    )
    expect(document.title).toBe('(3) Precisa de alguém · Tredane')
  })

  it('esconde a faixa se a única conversa à espera é a aberta', async () => {
    render(
      <NeedsPersonAlerts
        tenantId="t"
        api={makeApi({ needsPerson: 1, firstId: 'cnv_open' })}
        generation={1}
        openConversationId="cnv_open"
      />,
    )
    await waitFor(() =>
      expect(document.title).toBe('Precisa de alguém · Tredane'),
    )
    expect(screen.queryByTestId('needs-person-strip')).toBeNull()
  })

  it('restaura o título por omissão quando needsPerson = 0', async () => {
    const api = makeApi({ needsPerson: 0 })
    render(<NeedsPersonAlerts tenantId="t" api={api} generation={1} />)
    await waitFor(() =>
      expect(document.title).toBe('Tredane | Atendimento inteligente'),
    )
    expect(screen.queryByTestId('needs-person-strip')).toBeNull()
  })
})
