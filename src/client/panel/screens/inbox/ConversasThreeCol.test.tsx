import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversasThreeCol } from './ConversasArea'

vi.mock('../../tenant/TenantContext', () => ({
  useTenant: () => ({ active: { phase: 'none' }, listState: { phase: 'idle' } }),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubMatchMedia(wideContact: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('1280') ? wideContact : true,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

const api = new Proxy({}, { get: () => () => new Promise(() => {}) }) as never

describe('ConversasThreeCol', () => {
  it('abaixo de 1280px: contato fica numa gaveta que abre pelo botão', () => {
    stubMatchMedia(false)
    const { container } = render(
      <ConversasThreeCol tenantId="t" conversationId="c" api={api} generation={1} viewerId="u" isOwner />,
    )
    expect(container.querySelector('.conversas-3col--drawer')).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Contato' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver contato' }))
    expect(container.querySelector('#conversas-contact-panel')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(container.querySelector('#conversas-contact-panel')).toBeNull()
  })

  it('a partir de 1280px: 3 colunas com o contato em linha, sem botão', () => {
    stubMatchMedia(true)
    const { container } = render(
      <ConversasThreeCol tenantId="t" conversationId="c" api={api} generation={1} viewerId="u" isOwner />,
    )
    expect(container.querySelector('.conversas-3col--drawer')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ver contato' })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Contato' })).toBeTruthy()
  })

  it('sem conversa aberta: mesma moldura, estado vazio e sem coluna de contato', () => {
    stubMatchMedia(true)
    const { container } = render(
      <ConversasThreeCol tenantId="t" api={api} generation={1} viewerId="u" isOwner />,
    )
    expect(container.querySelector('.conversas-3col--empty')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Escolha uma conversa' })).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Contato' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ver contato' })).toBeNull()
    // A lista continua no mesmo lugar (mesma coluna) que com a conversa aberta.
    expect(container.querySelector('.conversas-3col-list')).toBeTruthy()
  })
})
