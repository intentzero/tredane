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
  it('a partir de 1280px o painel do contato abre aberto, por cima (sem coluna própria)', () => {
    localStorage.clear()
    stubMatchMedia(true)
    const { container } = render(
      <ConversasThreeCol tenantId="t" conversationId="c" api={api} generation={1} viewerId="u" isOwner />,
    )
    expect(container.querySelector('.conversas-3col')?.getAttribute('data-contact')).toBe('open')
    expect(screen.getByRole('complementary', { name: 'Contato' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ver contato' })).toBeNull()
  })

  it('abaixo de 1280px abre fechado: o painel não é montado nem buscado', () => {
    localStorage.clear()
    stubMatchMedia(false)
    const { container } = render(
      <ConversasThreeCol tenantId="t" conversationId="c" api={api} generation={1} viewerId="u" isOwner />,
    )
    expect(container.querySelector('.conversas-3col')?.getAttribute('data-contact')).toBe('closed')
    expect(container.querySelector('#conversas-contact-panel')).toBeNull()
  })

  it('Esc fecha o painel, lembra a escolha e o painel fechado fica fora do alcance (inert)', () => {
    localStorage.clear()
    stubMatchMedia(true)
    const { container } = render(
      <ConversasThreeCol tenantId="t" conversationId="c" api={api} generation={1} viewerId="u" isOwner />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(container.querySelector('.conversas-3col')?.getAttribute('data-contact')).toBe('closed')
    expect(localStorage.getItem('tredane.contactPanel')).toBe('closed')
    const aside = container.querySelector('#conversas-contact-panel')
    expect(aside?.getAttribute('aria-hidden')).toBe('true')
    expect(aside?.hasAttribute('inert')).toBe(true)
  })

  it('a escolha lembrada vale mais que a largura da janela', () => {
    localStorage.setItem('tredane.contactPanel', 'open')
    stubMatchMedia(false)
    const { container } = render(
      <ConversasThreeCol tenantId="t" conversationId="c" api={api} generation={1} viewerId="u" isOwner />,
    )
    expect(container.querySelector('.conversas-3col')?.getAttribute('data-contact')).toBe('open')
  })

  it('sem conversa aberta: mesma moldura, estado vazio e sem painel de contato', () => {
    stubMatchMedia(true)
    const { container } = render(
      <ConversasThreeCol tenantId="t" api={api} generation={1} viewerId="u" isOwner />,
    )
    expect(container.querySelector('.conversas-3col--empty')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Escolha uma conversa' })).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Contato' })).toBeNull()
    expect(container.querySelector('.conversas-3col-list')).toBeTruthy()
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
