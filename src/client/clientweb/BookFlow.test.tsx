import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../ui/panel.css'
import { ClientWebApp } from './ClientWebApp'
import { resetExchangesForTest } from './api'

const STATE = {
  clinicName: 'Clínica Aurora',
  firstName: 'Marina',
  timezone: 'America/Sao_Paulo',
  appointments: [],
  sessionExpiresAt: Date.UTC(2026, 10, 25, 18, 0),
}

const CATALOG = {
  timezone: 'America/Sao_Paulo',
  horizonDays: 30,
  today: '2026-11-17',
  services: [
    { id: 'svc-limpeza', name: 'Limpeza de pele', durationMinutes: 45, priceCents: 12_000, audience: 'qualquer', variantKind: null, variantKindPlural: null, variantSelection: 'varias', requiresSignal: false, zones: [] },
    {
      id: 'svc-laser', name: 'Depilação a laser', durationMinutes: 60, priceCents: null, audience: 'qualquer', variantKind: 'Zona', variantKindPlural: 'Zonas', variantSelection: 'varias', requiresSignal: true,
      zones: [
        { id: 'z-ax', name: 'Axilas', audience: 'feminino', durationMinutes: 10, priceCents: 9_000 },
        { id: 'z-vi', name: 'Virilha', audience: 'feminino', durationMinutes: 20, priceCents: 14_000 },
        { id: 'z-ba', name: 'Barba', audience: 'masculino', durationMinutes: 30, priceCents: 8_000 },
      ],
    },
  ],
}

const SLOTS = [
  { id: '2026-11-18T09:00', date: '2026-11-18', time: '09:00' },
  { id: '2026-11-18T14:15', date: '2026-11-18', time: '14:15' },
  { id: '2026-11-19T10:00', date: '2026-11-19', time: '10:00' },
]

type Calls = Array<{ url: string; method: string; body: Record<string, unknown> | null }>

function mockApi(opts: { book?: unknown; bookStatus?: number; slots?: unknown[] } = {}) {
  const calls: Calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
      calls.push({ url, method: init?.method ?? 'GET', body })
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
      if (url.endsWith('/api/c/exchange')) return json({ ok: true })
      if (url.endsWith('/api/c/state')) return json(STATE)
      if (url.endsWith('/api/c/catalog')) return json(CATALOG)
      if (url.endsWith('/api/c/availability')) return json({ slots: opts.slots ?? SLOTS })
      if (url.endsWith('/api/c/book')) {
        return json(opts.book ?? { status: 'booked', appointment: { id: 'apt-1', startsAt: 1, endsAt: 2, serviceName: 'Limpeza de pele' } }, opts.bookStatus ?? 200)
      }
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

async function openBooking() {
  const user = userEvent.setup()
  render(<ClientWebApp />)
  await user.click(await screen.findByRole('button', { name: 'Agendar novo horário' }))
  return user
}

describe('agendar pela página (C-02 a C-06)', () => {
  it('serviço sem zonas: escolhe, escolhe a hora, revê e confirma — pedidos só com ids do catálogo', async () => {
    const calls = mockApi()
    const user = await openBooking()
    // O catálogo depende de género: pergunta primeiro «Para quem é?».
    expect(await screen.findByRole('heading', { name: 'Para quem é?' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Feminino' }))

    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    expect(await screen.findByRole('heading', { name: 'Quando?' })).toBeTruthy()
    const slotBtn = await screen.findByRole('button', { name: '14:15' })
    await user.click(slotBtn)

    expect(await screen.findByRole('heading', { name: 'Confirme o horário' })).toBeTruthy()
    expect(screen.getByText('Esta proposta vale por 30 min.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByRole('heading', { name: 'Horário marcado' })).toBeTruthy()
    expect(screen.getByText(/Se não foi você quem marcou/)).toBeTruthy()

    const book = calls.find((c) => c.url.endsWith('/api/c/book'))!
    expect(book.body).toEqual({ serviceId: 'svc-limpeza', variantIds: [], line: 'feminino', slotId: '2026-11-18T14:15' })
    expect(calls.some((c) => JSON.stringify(c.body ?? {}).match(/tenant|contact/i))).toBe(false)
  })

  it('serviço com zonas: só mostra as da linha, soma o total e avisa do sinal', async () => {
    const calls = mockApi()
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Depilação a laser/ }))

    expect(await screen.findByRole('heading', { name: 'Que zonas?' })).toBeTruthy()
    expect(screen.queryByText('Barba')).toBeNull()
    const next = screen.getByRole('button', { name: 'Ver horários' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    await user.click(screen.getByLabelText(/Axilas/))
    await user.click(screen.getByLabelText(/Virilha/))
    const total = screen.getByRole('status')
    expect(within(total).getByText(/2 opções · 30 min/)).toBeTruthy()
    expect(within(total).getByText(/R\$\s?230/)).toBeTruthy()
    await user.click(next)

    await user.click(await screen.findByRole('button', { name: '09:00' }))
    expect(await screen.findByText(/o horário só fica reservado depois do pagamento/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await screen.findByRole('heading', { name: 'Horário marcado' })

    const avail = calls.find((c) => c.url.endsWith('/api/c/availability'))!
    expect(avail.body).toMatchObject({ serviceId: 'svc-laser', variantIds: ['z-ax', 'z-vi'] })
    expect(calls.find((c) => c.url.endsWith('/api/c/book'))!.body).toMatchObject({ variantIds: ['z-ax', 'z-vi'], line: 'feminino' })
  })

  it('horas livres de semanas seguintes: setas pedem o intervalo da semana', async () => {
    const calls = mockApi()
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    await screen.findByRole('button', { name: '14:15' })
    const prev = screen.getByRole('button', { name: 'Semana anterior' }) as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Próxima semana' }))
    await waitFor(() => {
      const reqs = calls.filter((c) => c.url.endsWith('/api/c/availability'))
      expect(reqs[reqs.length - 1]!.body).toMatchObject({ from: '2026-11-24', to: '2026-11-30' })
    })
    expect((screen.getByRole('button', { name: 'Semana anterior' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('hora ocupada ao confirmar: volta às horas com aviso e não marca', async () => {
    mockApi({ book: { status: 'slot_taken' } })
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    await user.click(await screen.findByRole('button', { name: '14:15' }))
    await user.click(await screen.findByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Esse horário acabou de ser ocupado. Escolha outro.')
    expect(screen.getByRole('heading', { name: 'Quando?' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Horário marcado' })).toBeNull()
  })

  it('Confirmar só envia uma vez mesmo com cliques repetidos', async () => {
    const calls = mockApi()
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    await user.click(await screen.findByRole('button', { name: '14:15' }))
    const confirm = await screen.findByRole('button', { name: 'Confirmar' })
    await user.dblClick(confirm)
    await screen.findByRole('heading', { name: 'Horário marcado' })
    expect(calls.filter((c) => c.url.endsWith('/api/c/book'))).toHaveLength(1)
  })

  it('pausa da owner, Pix e erro têm ecrã próprio e nunca dizem «marcado»', async () => {
    for (const [book, title] of [
      [{ status: 'paused' }, 'A equipe atende por aqui'],
      [{ status: 'pix_signal' }, 'Falta só o sinal'],
      [{ status: 'error', error: 'proposal_failed' }, 'Não foi possível confirmar'],
    ] as const) {
      cleanup()
      resetExchangesForTest()
      window.history.replaceState(null, '', '/c/cw1_exemplo')
      mockApi({ book })
      const user = await openBooking()
      await user.click(await screen.findByRole('button', { name: 'Feminino' }))
      await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
      await user.click(await screen.findByRole('button', { name: '14:15' }))
      await user.click(await screen.findByRole('button', { name: 'Confirmar' }))
      expect(await screen.findByRole('heading', { name: title })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Horário marcado' })).toBeNull()
    }
  })

  it('sem horários na semana diz isso e oferece a equipe', async () => {
    mockApi({ slots: [] })
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    expect(await screen.findByText(/Sem horários livres nesta semana/)).toBeTruthy()
  })

  it('o botão Voltar percorre os passos e sai para as marcações', async () => {
    mockApi()
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Depilação a laser/ }))
    await screen.findByRole('heading', { name: 'Que zonas?' })
    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(await screen.findByRole('heading', { name: 'Qual serviço?' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(await screen.findByRole('heading', { name: 'Para quem é?' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(await screen.findByRole('heading', { name: 'Olá, Marina' })).toBeTruthy()
  })

  it('sem violações de acessibilidade nos passos (axe)', async () => {
    mockApi()
    const user = await openBooking()
    const check = async (container: HTMLElement) => {
      const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
      expect(res.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([])
    }
    await screen.findByRole('heading', { name: 'Para quem é?' })
    await check(document.body)
    await user.click(screen.getByRole('button', { name: 'Feminino' }))
    await screen.findByRole('heading', { name: 'Qual serviço?' })
    await check(document.body)
    await user.click(screen.getByRole('button', { name: /Depilação a laser/ }))
    await screen.findByRole('heading', { name: 'Que zonas?' })
    await check(document.body)
    await user.click(screen.getByLabelText(/Axilas/))
    await user.click(screen.getByRole('button', { name: 'Ver horários' }))
    await screen.findByRole('button', { name: '09:00' })
    await check(document.body)
    await user.click(screen.getByRole('button', { name: '09:00' }))
    await screen.findByRole('heading', { name: 'Confirme o horário' })
    await check(document.body)
  })
})
