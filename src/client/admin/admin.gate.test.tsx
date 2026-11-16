import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../ui/panel.css'
import { writeSynthUserId } from '../panel/auth/session'
import { AdminApp } from './AdminApp'

type MeOutcome = { isSuperadmin: boolean } | { status: number; error?: string } | 'network'

function mockFetch(outcome: () => MeOutcome) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/api/auth/client-config')) {
        return new Response(
          JSON.stringify({ authMode: 'synthetic', clerkPublishableKey: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/me')) {
        const o = outcome()
        if (o === 'network') throw new TypeError('Failed to fetch')
        if ('status' in o) {
          return new Response(JSON.stringify({ error: o.error ?? 'unknown' }), { status: o.status })
        }
        return new Response(
          JSON.stringify({ kind: 'human', clerkUserId: 'user_x', sessionId: 's', isSuperadmin: o.isSuperadmin }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    }),
  )
  return calls
}

describe('Platform Admin — gate de superadmin (#828, AC-81)', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    sessionStorage.clear()
    writeSynthUserId('user_synth_superadmin')
    window.history.replaceState(null, '', '/admin')
  })

  it('superadmin abre a visão geral com as cinco áreas', async () => {
    mockFetch(() => ({ isSuperadmin: true }))
    const { container } = render(<AdminApp />)
    const nav = await screen.findByRole('navigation', { name: 'Platform Admin' })
    for (const label of ['Visão geral', 'Clínicas', 'Suporte', 'Saúde', 'Qualidade IA']) {
      expect(nav.textContent).toContain(label)
    }
    expect(screen.getByRole('link', { name: 'Visão geral' }).getAttribute('aria-current')).toBe('page')
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })

  it('navega entre áreas sem recarregar e marca a atual', async () => {
    mockFetch(() => ({ isSuperadmin: true }))
    const user = userEvent.setup()
    render(<AdminApp />)
    await user.click(await screen.findByRole('link', { name: 'Saúde' }))
    expect(window.location.pathname).toBe('/admin/saude')
    expect(screen.getByRole('link', { name: 'Saúde' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('heading', { level: 1, name: 'Saúde' })).toBeTruthy()
  })

  it('sub-rota desconhecida mostra «Página não encontrada» mesmo para superadmin', async () => {
    window.history.replaceState(null, '', '/admin/nao-existe')
    mockFetch(() => ({ isSuperadmin: true }))
    render(<AdminApp />)
    expect(await screen.findByText('Página não encontrada')).toBeTruthy()
  })

  it('sem a flag: «Página não encontrada» e nenhuma navegação do admin', async () => {
    mockFetch(() => ({ isSuperadmin: false }))
    render(<AdminApp />)
    expect(await screen.findByText('Página não encontrada')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Platform Admin' })).toBeNull()
    expect(screen.queryByText(/Platform Admin/)).toBeNull()
  })

  it('valor não booleano em isSuperadmin não abre (fail closed)', async () => {
    mockFetch(() => ({ isSuperadmin: 'true' as unknown as boolean }))
    render(<AdminApp />)
    expect(await screen.findByText('Página não encontrada')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Platform Admin' })).toBeNull()
  })

  it('falha da verificação mostra erro com «Tentar de novo» e nunca concede acesso', async () => {
    let outcome: MeOutcome = { status: 503 }
    mockFetch(() => outcome)
    const user = userEvent.setup()
    render(<AdminApp />)
    expect(await screen.findByText('Não foi possível verificar o acesso')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Platform Admin' })).toBeNull()
    outcome = { isSuperadmin: true }
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Platform Admin' })).toBeTruthy())
  })

  it('falha de rede também cai no erro com repetir', async () => {
    mockFetch(() => 'network')
    render(<AdminApp />)
    expect(await screen.findByText('Não foi possível verificar o acesso')).toBeTruthy()
  })
})
