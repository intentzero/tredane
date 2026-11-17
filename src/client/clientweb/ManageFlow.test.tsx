import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../ui/panel.css'
import { ClientWebApp } from './ClientWebApp'
import { resetExchangesForTest } from './api'

const APT = { id: 'apt-1', serviceName: 'Limpeza de pele', startsAt: Date.UTC(2026, 10, 25, 17, 15), endsAt: Date.UTC(2026, 10, 25, 18, 0), hasPaidSignal: false }

const CATALOG = { timezone: 'America/Sao_Paulo', horizonDays: 30, today: '2026-11-17', services: [] }
const SLOTS = [
  { id: '2026-11-18T09:00', date: '2026-11-18', time: '09:00' },
  { id: '2026-11-18T14:15', date: '2026-11-18', time: '14:15' },
]

type Calls = Array<{ url: string; method: string; body: Record<string, unknown> | null }>

function mockApi(opts: { signal?: boolean; reschedule?: unknown; cancel?: unknown; ask?: unknown; exchange?: unknown } = {}) {
  const calls: Calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
      calls.push({ url, method: init?.method ?? 'GET', body })
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
      if (url.endsWith('/api/c/exchange')) return json(opts.exchange ?? { ok: true, purpose: 'home', appointmentId: null })
      if (url.endsWith('/api/c/state')) {
        return json({ clinicName: 'Clínica Aurora', firstName: 'Marina', timezone: 'America/Sao_Paulo', appointments: [{ ...APT, hasPaidSignal: opts.signal === true }], sessionExpiresAt: 1 })
      }
      if (url.endsWith('/api/c/catalog')) return json(CATALOG)
      if (url.endsWith('/api/c/availability')) return json({ slots: SLOTS })
      if (url.endsWith('/api/c/reschedule')) return json(opts.reschedule ?? { status: 'booked', appointment: { id: 'apt-1', startsAt: 1, endsAt: 2, serviceName: 'Limpeza de pele' } })
      if (url.endsWith('/api/c/cancel')) return json(opts.cancel ?? { status: 'cancelled', serviceName: 'Limpeza de pele', startsAt: 1 })
      if (url.endsWith('/api/c/ask-team')) return json(opts.ask ?? { status: 'asked' })
      return json({}, 404)
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

async function home() {
  const user = userEvent.setup()
  render(<ClientWebApp />)
  await screen.findByRole('heading', { name: 'Olá, Marina' })
  return user
}

describe('remarcar pela página (C-07)', () => {
  it('pede as horas da marcação, escolhe, confirma e mostra o recibo', async () => {
    const calls = mockApi()
    const user = await home()
    await user.click(screen.getByRole('button', { name: 'Remarcar Limpeza de pele' }))
    expect(await screen.findByRole('heading', { name: 'Nova data e hora' })).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: '14:15' }))
    expect(await screen.findByRole('heading', { name: 'Confirme a remarcação' })).toBeTruthy()
    expect(screen.getByText('Remarcar não gera novo sinal. O serviço e as zonas ficam iguais.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Confirmar remarcação' }))
    expect(await screen.findByRole('heading', { name: 'Marcação remarcada' })).toBeTruthy()
    expect(screen.getByText(/Se não foi você quem remarcou/)).toBeTruthy()

    const avail = calls.find((c) => c.url.endsWith('/api/c/availability'))!
    expect(avail.body).toEqual({ appointmentId: 'apt-1', from: '2026-11-17', to: '2026-11-23' })
    expect(calls.find((c) => c.url.endsWith('/api/c/reschedule'))!.body).toEqual({ appointmentId: 'apt-1', slotId: '2026-11-18T14:15' })
    expect(calls.some((c) => JSON.stringify(c.body ?? {}).match(/tenant|contact/i))).toBe(false)
  })

  it('hora ocupada ao confirmar volta às horas com aviso; nunca diz «remarcada»', async () => {
    mockApi({ reschedule: { status: 'slot_taken' } })
    const user = await home()
    await user.click(screen.getByRole('button', { name: 'Remarcar Limpeza de pele' }))
    await user.click(await screen.findByRole('button', { name: '14:15' }))
    await user.click(await screen.findByRole('button', { name: 'Confirmar remarcação' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Esse horário acabou de ser ocupado. Escolha outro.')
    expect(screen.queryByRole('heading', { name: 'Marcação remarcada' })).toBeNull()
  })

  it('Voltar sai para as marcações sem alterar nada', async () => {
    const calls = mockApi()
    const user = await home()
    await user.click(screen.getByRole('button', { name: 'Remarcar Limpeza de pele' }))
    await screen.findByRole('heading', { name: 'Nova data e hora' })
    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(await screen.findByRole('heading', { name: 'Olá, Marina' })).toBeTruthy()
    expect(calls.some((c) => c.url.endsWith('/api/c/reschedule'))).toBe(false)
  })
})

describe('cancelar pela página (C-08)', () => {
  it('sem sinal: confirma e cancela uma vez, mesmo com cliques repetidos', async () => {
    const calls = mockApi()
    const user = await home()
    await user.click(screen.getByRole('button', { name: 'Cancelar Limpeza de pele' }))
    expect(await screen.findByRole('heading', { name: 'Cancelar marcação?' })).toBeTruthy()
    await user.dblClick(screen.getByRole('button', { name: 'Cancelar marcação' }))
    expect(await screen.findByRole('heading', { name: 'Marcação cancelada' })).toBeTruthy()
    expect(calls.filter((c) => c.url.endsWith('/api/c/cancel'))).toHaveLength(1)
    expect(calls.find((c) => c.url.endsWith('/api/c/cancel'))!.body).toEqual({ appointmentId: 'apt-1' })
  })

  it('«Manter marcação» não cancela', async () => {
    const calls = mockApi()
    const user = await home()
    await user.click(screen.getByRole('button', { name: 'Cancelar Limpeza de pele' }))
    await user.click(await screen.findByRole('button', { name: 'Manter marcação' }))
    expect(await screen.findByRole('heading', { name: 'Olá, Marina' })).toBeTruthy()
    expect(calls.some((c) => c.url.endsWith('/api/c/cancel'))).toBe(false)
  })

  it('com sinal pago nunca chama cancelar: pede à equipe', async () => {
    const calls = mockApi({ signal: true })
    const user = await home()
    await user.click(screen.getByRole('button', { name: 'Pedir cancelamento de Limpeza de pele' }))
    expect(await screen.findByRole('heading', { name: 'Pedir cancelamento' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancelar marcação' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Pedir à equipe' }))
    expect(await screen.findByRole('heading', { name: 'A equipe foi avisada' })).toBeTruthy()
    expect(calls.some((c) => c.url.endsWith('/api/c/cancel'))).toBe(false)
    expect(calls.filter((c) => c.url.endsWith('/api/c/ask-team'))).toHaveLength(1)
  })

  it('fora do expediente diz isso; marcação inexistente e erro têm aviso próprio', async () => {
    for (const [setup, click, title] of [
      [{ signal: true, ask: { status: 'after_hours' } }, 'Pedir à equipe', 'Pedido recebido'],
      [{ cancel: { status: 'not_found' } }, 'Cancelar marcação', 'Esta marcação já não existe'],
    ] as const) {
      cleanup()
      resetExchangesForTest()
      window.history.replaceState(null, '', '/c/cw1_exemplo')
      mockApi(setup)
      const user = await home()
      await user.click(screen.getAllByRole('button').find((b) => /Cancelar|Pedir cancelamento/.test(b.getAttribute('aria-label') ?? ''))!)
      await user.click(await screen.findByRole('button', { name: click }))
      expect(await screen.findByRole('heading', { name: title })).toBeTruthy()
    }
  })

  it('sem violações de acessibilidade nos ecrãs de remarcar e cancelar (axe)', async () => {
    mockApi()
    const user = await home()
    const check = async () => {
      const res = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })
      expect(res.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([])
    }
    await check()
    await user.click(screen.getByRole('button', { name: 'Cancelar Limpeza de pele' }))
    await screen.findByRole('heading', { name: 'Cancelar marcação?' })
    await check()
    await user.click(screen.getByRole('button', { name: 'Manter marcação' }))
    await screen.findByRole('heading', { name: 'Olá, Marina' })
    await user.click(screen.getByRole('button', { name: 'Remarcar Limpeza de pele' }))
    await screen.findByRole('button', { name: '14:15' })
    await check()
    await user.click(screen.getByRole('button', { name: '14:15' }))
    await screen.findByRole('heading', { name: 'Confirme a remarcação' })
    await check()
  })
})

describe('link de remarcar e cancelar abre direto na marcação (Fase 5)', () => {
  it('finalidade cancelar com a marcação alvo abre o ecrã de cancelar', async () => {
    mockApi({ exchange: { ok: true, purpose: 'cancelar', appointmentId: 'apt-1' } })
    render(<ClientWebApp />)
    expect(await screen.findByRole('heading', { name: 'Cancelar marcação?' })).toBeTruthy()
    expect(screen.getByText('Limpeza de pele')).toBeTruthy()
  })

  it('finalidade remarcar abre as horas da marcação', async () => {
    const calls = mockApi({ exchange: { ok: true, purpose: 'remarcar', appointmentId: 'apt-1' } })
    render(<ClientWebApp />)
    expect(await screen.findByRole('heading', { name: 'Nova data e hora' })).toBeTruthy()
    await screen.findByRole('button', { name: '14:15' })
    expect(calls.find((c) => c.url.endsWith('/api/c/availability'))!.body).toMatchObject({ appointmentId: 'apt-1' })
  })

  it('marcação alvo que já não existe, ou link sem alvo, mostra as marcações', async () => {
    mockApi({ exchange: { ok: true, purpose: 'cancelar', appointmentId: 'apt-que-ja-nao-existe' } })
    render(<ClientWebApp />)
    expect(await screen.findByRole('heading', { name: 'Olá, Marina' })).toBeTruthy()
    cleanup()
    resetExchangesForTest()
    window.history.replaceState(null, '', '/c/cw1_outro')
    mockApi({ exchange: { ok: true, purpose: 'remarcar', appointmentId: null } })
    render(<ClientWebApp />)
    expect(await screen.findByRole('heading', { name: 'Olá, Marina' })).toBeTruthy()
  })

  it('depois de cancelar por este link, «Ver minhas marcações» volta ao início', async () => {
    mockApi({ exchange: { ok: true, purpose: 'cancelar', appointmentId: 'apt-1' } })
    const user = userEvent.setup()
    render(<ClientWebApp />)
    await user.click(await screen.findByRole('button', { name: 'Cancelar marcação' }))
    await user.click(await screen.findByRole('button', { name: 'Ver minhas marcações' }))
    expect(await screen.findByRole('heading', { name: 'Olá, Marina' })).toBeTruthy()
  })
})
