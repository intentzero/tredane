import { StrictMode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../ui/panel.css'
import { ClientWebApp } from './ClientWebApp'
import { resetExchangesForTest } from './api'
import { clientWebTokenFromPath, isClientWebPath } from './routes'

const STATE = {
  clinicName: 'Clínica Aurora',
  firstName: 'Marina',
  timezone: 'America/Sao_Paulo',
  appointments: [
    { id: 'apt-1', serviceName: 'Limpeza de pele', startsAt: Date.UTC(2026, 10, 25, 17, 15), endsAt: Date.UTC(2026, 10, 25, 18, 0), hasPaidSignal: false },
  ],
  sessionExpiresAt: Date.UTC(2026, 10, 25, 18, 0),
}

function mockApi(opts: { exchange?: number; state?: number } = {}) {
  const calls: Array<{ url: string; method: string; body?: string }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined })
      if (url.endsWith('/api/c/exchange')) {
        return new Response(JSON.stringify(opts.exchange === 410 ? { error: 'link_unavailable' } : { ok: true }), {
          status: opts.exchange ?? 200,
        })
      }
      if (url.endsWith('/api/c/state')) {
        return new Response(JSON.stringify(opts.state === 401 ? { error: 'session_required' } : STATE), {
          status: opts.state ?? 200,
        })
      }
      return new Response('{}', { status: 404 })
    }),
  )
  return calls
}

beforeEach(() => {
  resetExchangesForTest()
  window.history.replaceState(null, '', '/c/cw1_exemplo')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('rotas da página da cliente', () => {
  it('reconhece /c e extrai o token só do formato certo', () => {
    expect(isClientWebPath('/c')).toBe(true)
    expect(isClientWebPath('/c/cw1_x')).toBe(true)
    expect(isClientWebPath('/clinicas')).toBe(false)
    // O painel da equipe usa /c/:clínica/:área: nunca é a página da cliente.
    expect(isClientWebPath('/c/tenant_dec0de000000000000000001/conversas')).toBe(false)
    expect(isClientWebPath('/c/tenant_dec0de000000000000000001/clinica/equipe')).toBe(false)
    expect(isClientWebPath('/c/cw1_x/')).toBe(true)
    expect(clientWebTokenFromPath('/c/cw1_abc-DEF_9')).toBe('cw1_abc-DEF_9')
    expect(clientWebTokenFromPath('/c')).toBeNull()
    expect(clientWebTokenFromPath('/c/a/b')).toBeNull()
    expect(clientWebTokenFromPath('/c/with space')).toBeNull()
  })
})

describe('ClientWebApp (C-01, C-09)', () => {
  it('troca o token, tira-o do endereço e mostra as marcações', async () => {
    const calls = mockApi()
    render(<ClientWebApp />)
    expect(await screen.findByRole('heading', { name: 'Olá, Marina' })).toBeTruthy()
    expect(screen.getByText('Limpeza de pele')).toBeTruthy()
    expect(screen.getByText(/qua 25\/11 · 14:15 · 45 min/)).toBeTruthy()
    expect(window.location.pathname).toBe('/c')
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/c/exchange', 'GET /api/c/state'])
    expect(JSON.parse(calls[0]!.body!)).toEqual({ token: 'cw1_exemplo' })
    expect(calls.some((c) => /tenant|contact/i.test(c.url + (c.body ?? '')))).toBe(false)
  })

  it('em StrictMode só faz uma troca (o token é de uso único)', async () => {
    const calls = mockApi()
    render(
      <StrictMode>
        <ClientWebApp />
      </StrictMode>,
    )
    await screen.findByRole('heading', { name: 'Olá, Marina' })
    expect(calls.filter((c) => c.url.endsWith('/api/c/exchange'))).toHaveLength(1)
  })

  it('link usado ou expirado mostra o ecrã de aviso e não pede o estado', async () => {
    const calls = mockApi({ exchange: 410 })
    render(<ClientWebApp />)
    expect(await screen.findByRole('heading', { name: 'Este link já foi usado' })).toBeTruthy()
    expect(calls.some((c) => c.url.endsWith('/api/c/state'))).toBe(false)
  })

  it('sem sessão (401) mostra o mesmo aviso', async () => {
    window.history.replaceState(null, '', '/c')
    const calls = mockApi({ state: 401 })
    render(<ClientWebApp />)
    expect(await screen.findByRole('heading', { name: 'Este link já foi usado' })).toBeTruthy()
    expect(calls.some((c) => c.url.endsWith('/api/c/exchange'))).toBe(false)
  })

  it('sem marcações futuras diz isso e não mostra lista', async () => {
    mockApi()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/api/c/exchange')
          ? new Response('{}', { status: 200 })
          : new Response(JSON.stringify({ ...STATE, appointments: [], firstName: null }), { status: 200 }),
      ),
    )
    render(<ClientWebApp />)
    expect(await screen.findByRole('heading', { name: 'Olá' })).toBeTruthy()
    expect(screen.getByText('Você não tem marcações futuras.')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('mostra «Como chegar» em cada marcação só quando há link (DEC-211)', async () => {
    mockApi()
    const { unmount } = render(<ClientWebApp />)
    await screen.findByRole('heading', { name: 'Olá, Marina' })
    expect(screen.queryByRole('link', { name: 'Como chegar' })).toBeNull()
    unmount()
    resetExchangesForTest()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/api/c/exchange')
          ? new Response('{}', { status: 200 })
          : new Response(JSON.stringify({ ...STATE, locationUrl: 'https://maps.app.goo.gl/clinica-teste' }), { status: 200 }),
      ),
    )
    render(<ClientWebApp />)
    const link = await screen.findByRole('link', { name: 'Como chegar' })
    expect(link.getAttribute('href')).toBe('https://maps.app.goo.gl/clinica-teste')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('mostra Agendar e, em cada marcação, Remarcar e Cancelar', async () => {
    mockApi()
    render(<ClientWebApp />)
    await screen.findByRole('heading', { name: 'Olá, Marina' })
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Remarcar', 'Cancelar', 'Agendar novo horário'])
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('não tem violações de acessibilidade (axe)', async () => {
    mockApi()
    const { container } = render(<ClientWebApp />)
    await screen.findByRole('heading', { name: 'Olá, Marina' })
    await waitFor(async () => {
      const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
      expect(results.violations.map((v) => v.id)).toEqual([])
    })
  })
})
