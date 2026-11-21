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
    {
      id: 'svc-limpeza',
      name: 'Limpeza de pele',
      synonyms: ['limpeza facial'],
      durationMinutes: 45,
      priceCents: 12_000,
      audience: 'qualquer',
      variantKind: null,
      variantKindPlural: null,
      variantSelection: 'varias',
      requiresSignal: false,
      zones: [],
      professionals: [
        { id: 'pro-gi', name: 'Gi' },
        { id: 'pro-paula', name: 'Paula' },
      ],
    },
    {
      id: 'svc-laser', name: 'Depilação a laser', synonyms: [], durationMinutes: 60, priceCents: null, audience: 'qualquer', variantKind: 'Zona', variantKindPlural: 'Zonas', variantSelection: 'varias', requiresSignal: true,
      zones: [
        { id: 'z-ax', name: 'Axilas', synonyms: ['sovaco'], audience: 'feminino', durationMinutes: 10, priceCents: 9_000 },
        { id: 'z-vi', name: 'Virilha', synonyms: [], audience: 'feminino', durationMinutes: 20, priceCents: 14_000 },
        { id: 'z-ba', name: 'Barba', synonyms: [], audience: 'masculino', durationMinutes: 30, priceCents: 8_000 },
      ],
      combos: [{ id: 'c-ax-vi', name: 'Axilas + virilha', priceCents: 20_000, zoneIds: ['z-ax', 'z-vi'] }],
      professionals: [{ id: 'pro-gi', name: 'Gi' }],
    },
  ],
}

const SLOTS = [
  { id: '2026-11-18T09:00', date: '2026-11-18', time: '09:00' },
  { id: '2026-11-18T14:15', date: '2026-11-18', time: '14:15' },
  { id: '2026-11-19T10:00', date: '2026-11-19', time: '10:00' },
]

type Calls = Array<{ url: string; method: string; body: Record<string, unknown> | null }>

function mockApi(opts: { book?: unknown; bookStatus?: number; slots?: unknown[]; exchange?: unknown } = {}) {
  const calls: Calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
      calls.push({ url, method: init?.method ?? 'GET', body })
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
      if (url.endsWith('/api/c/exchange')) return json(opts.exchange ?? { ok: true })
      if (url.endsWith('/api/c/state')) return json(STATE)
      if (url.endsWith('/api/c/catalog')) return json(CATALOG)
      if (url.endsWith('/api/c/availability')) {
        const all = (opts.slots ?? SLOTS) as Array<{ date: string }>
        const only = body?.daysOnly === true
        return json({ slots: only ? all.filter((x, i) => all.findIndex((y) => y.date === x.date) === i) : all })
      }
      if (url.endsWith('/api/c/book')) {
        return json(
          opts.book ?? {
            status: 'booked',
            appointment: {
              id: 'apt-1',
              startsAt: 1,
              endsAt: 2,
              serviceName: 'Limpeza de pele',
              professionalName: 'Gi',
            },
          },
          opts.bookStatus ?? 200,
        )
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
  it('link de agendar com serviço reconhecido no chat (DEC-202): abre direto no horário desse serviço', async () => {
    const calls = mockApi({ exchange: { ok: true, purpose: 'agendar', appointmentId: null, serviceId: 'svc-limpeza' } })
    render(<ClientWebApp />)
    expect(await screen.findByRole('heading', { name: 'Quando?' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Qual serviço?' })).toBeNull()
    expect(await screen.findByText(/Limpeza de pele · 45 min/)).toBeTruthy()
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/c/availability'))).toBe(true))
  })

  it('serviço do chat que depende de género continua a perguntar «Para quem é?» primeiro', async () => {
    mockApi({ exchange: { ok: true, purpose: 'agendar', appointmentId: null, serviceId: 'svc-laser' } })
    render(<ClientWebApp />)
    expect(await screen.findByRole('heading', { name: 'Para quem é?' })).toBeTruthy()
  })

  it('CW-11: link com serviço e linha masculina abre no serviço certo sem «Para quem é?»', async () => {
    mockApi({
      exchange: {
        ok: true,
        purpose: 'agendar',
        appointmentId: null,
        serviceId: 'svc-laser',
        audienceLine: 'masculino',
        variantIds: [],
      },
    })
    render(<ClientWebApp />)
    expect(await screen.findByRole('heading', { name: 'Que zonas?' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Para quem é?' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Qual serviço?' })).toBeNull()
    expect(screen.getByText('Barba')).toBeTruthy()
    expect(screen.queryByText('Axilas')).toBeNull()
  })

  it('serviço do chat que já não existe no catálogo abre a escolha de serviço', async () => {
    mockApi({ exchange: { ok: true, purpose: 'agendar', appointmentId: null, serviceId: 'svc-removido' } })
    render(<ClientWebApp />)
    expect(await screen.findByRole('heading', { name: 'Para quem é?' })).toBeTruthy()
  })

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
    expect(book.body).toEqual({
      serviceId: 'svc-limpeza',
      variantIds: [],
      line: 'feminino',
      slotId: '2026-11-18T14:15',
      professionalId: null,
    })
    expect(calls.some((c) => JSON.stringify(c.body ?? {}).match(/tenant|contact/i))).toBe(false)
  })

  it('DEC-218: Quem prefere? filtra horas e envia professionalId; Feito mostra o nome', async () => {
    const calls = mockApi()
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    expect(await screen.findByText('Quem prefere?')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Sem preferência' })).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Paula' }))
    await waitFor(() => {
      const avail = calls.filter((c) => c.url.endsWith('/api/c/availability'))
      expect(avail[avail.length - 1]!.body).toMatchObject({ professionalId: 'pro-paula' })
    })
    await user.click(await screen.findByRole('button', { name: '14:15' }))
    expect(await screen.findByRole('heading', { name: 'Confirme o horário' })).toBeTruthy()
    expect(screen.getByText('Paula')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByRole('heading', { name: 'Horário marcado' })).toBeTruthy()
    expect(screen.getByText(/com Gi/)).toBeTruthy()
    expect(calls.find((c) => c.url.endsWith('/api/c/book'))!.body).toMatchObject({
      professionalId: 'pro-paula',
    })
  })

  it('DEC-218 RR-5: serviço com uma só profissional esconde Quem prefere?', async () => {
    mockApi()
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Depilação a laser/ }))
    await user.click(await screen.findByLabelText('Axilas'))
    await user.click(screen.getByRole('button', { name: 'Ver horários' }))
    expect(await screen.findByRole('heading', { name: 'Quando?' })).toBeTruthy()
    expect(screen.queryByText('Quem prefere?')).toBeNull()
  })

  it('serviço com zonas: mostra combo, aplica preço DEC-080 e avisa do sinal', async () => {
    const calls = mockApi()
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Depilação a laser/ }))

    expect(await screen.findByRole('heading', { name: 'Que zonas?' })).toBeTruthy()
    expect(screen.queryByText('Barba')).toBeNull()
    expect(screen.getByLabelText('Combo Axilas + virilha')).toBeTruthy()
    const next = screen.getByRole('button', { name: 'Ver horários' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    await user.click(screen.getByLabelText('Axilas'))
    await user.click(screen.getByLabelText('Virilha'))
    const total = screen.getByRole('status')
    expect(within(total).getByText(/2 opções · 30 min · combo Axilas \+ virilha/)).toBeTruthy()
    // Soma sem combo = R$ 230; DEC-080 aplica o combo a R$ 200.
    expect(within(total).getByText(/^R\$\s?200$/)).toBeTruthy()
    expect(within(total).getByText(/economia R\$\s?30/)).toBeTruthy()
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

  it('dia sem slots selecciona-se e mostra o motivo no lugar da grade (TRE-33)', async () => {
    mockApi({
      slots: [
        { id: '2026-11-18T09:00', date: '2026-11-18', time: '09:00' },
        { id: '2026-11-18T14:15', date: '2026-11-18', time: '14:15' },
      ],
    })
    // Substitui o mock de availability para incluir emptyDays (closed vs full).
    const prev = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (!url.endsWith('/api/c/availability')) return prev(input, init)
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
        const only = body?.daysOnly === true
        const slots = only
          ? [{ id: '2026-11-18T09:00', date: '2026-11-18', time: '09:00' }]
          : [
              { id: '2026-11-18T09:00', date: '2026-11-18', time: '09:00' },
              { id: '2026-11-18T14:15', date: '2026-11-18', time: '14:15' },
            ]
        return new Response(
          JSON.stringify({
            slots,
            emptyDays: [
              { date: '2026-11-17', reason: 'closed' },
              { date: '2026-11-19', reason: 'full' },
              { date: '2026-11-20', reason: 'closed' },
              { date: '2026-11-21', reason: 'closed' },
              { date: '2026-11-22', reason: 'closed' },
              { date: '2026-11-23', reason: 'closed' },
            ],
          }),
          { status: 200 },
        )
      }),
    )
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    await screen.findByRole('button', { name: '14:15' })

    const closedDay = screen.getByRole('button', { name: /ter 17\/11, clínica fechada/ })
    expect((closedDay as HTMLButtonElement).disabled).toBe(false)
    await user.click(closedDay)
    expect(await screen.findByText('Clínica fechada neste dia.')).toBeTruthy()
    expect(screen.getByText(/Escolha outro dia na semana/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '14:15' })).toBeNull()
    expect(screen.getByText('Nada fica marcado antes de Confirmar.')).toBeTruthy()

    const fullDay = screen.getByRole('button', { name: /qui 19\/11, sem horários/ })
    await user.click(fullDay)
    expect(await screen.findByText('Sem horários disponíveis neste dia.')).toBeTruthy()
    expect(screen.getByText(/não há vagas livres para este serviço/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /qua 18\/11/ }))
    expect(await screen.findByRole('button', { name: '14:15' })).toBeTruthy()
    expect(screen.queryByText('Clínica fechada neste dia.')).toBeNull()
  })

  it('semana sem horas: dia seleccionável com motivo genérico', async () => {
    mockApi({ slots: [] })
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    expect(await screen.findByText('Sem horários disponíveis neste dia.')).toBeTruthy()
    expect(screen.getByText('Nada fica marcado antes de Confirmar.')).toBeTruthy()
    const emptyDay = screen.getByRole('button', { name: /ter 17\/11, sem horários/ })
    expect((emptyDay as HTMLButtonElement).disabled).toBe(false)
    expect(emptyDay.getAttribute('aria-pressed')).toBe('true')
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
    await user.click(screen.getByLabelText('Axilas'))
    await user.click(screen.getByRole('button', { name: 'Ver horários' }))
    await screen.findByRole('button', { name: '09:00' })
    await check(document.body)
    await user.click(screen.getByRole('button', { name: '09:00' }))
    await screen.findByRole('heading', { name: 'Confirme o horário' })
    await check(document.body)
  })

  it('pesquisa em Serviço: «sovaco» acha a zona Axilas pelo sinónimo, sem o mostrar, e tocar leva às zonas com ela marcada', async () => {
    const calls = mockApi()
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.type(await screen.findByRole('searchbox', { name: 'Procurar serviço ou zona' }), 'sovaco')
    expect(await screen.findByText('1 resultado')).toBeTruthy()
    const results = screen.getByRole('navigation', { name: 'Resultados' })
    expect(within(results).getByText('Depilação a laser')).toBeTruthy()
    expect(within(results).getByRole('button', { name: /Axilas.*Zona/ })).toBeTruthy()
    // O sinónimo só serve para casar: nunca aparece escrito na página.
    expect(screen.queryByText(/sovaco/i)).toBeNull()
    await user.click(within(results).getByRole('button', { name: /Axilas.*Zona/ }))
    expect(await screen.findByRole('heading', { name: 'Que zonas?' })).toBeTruthy()
    expect((screen.getByLabelText('Axilas') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole('button', { name: 'Ver horários' })).toHaveProperty('disabled', false)
    expect(calls.length).toBeGreaterThan(0)
  })

  it('pesquisa: «axila» sem acento nem plural, e «botox» mostra «Nada encontrado» com saída', async () => {
    mockApi()
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    const box = await screen.findByRole('searchbox', { name: 'Procurar serviço ou zona' })
    await user.type(box, 'AXILA')
    const axilaResults = screen.getByRole('navigation', { name: 'Resultados' })
    expect(within(axilaResults).getByRole('button', { name: /Axilas.*Zona/ })).toBeTruthy()
    expect(within(axilaResults).getByRole('button', { name: /Axilas \+ virilha/ })).toBeTruthy()
    await user.clear(box)
    await user.type(box, 'botox')
    expect(await screen.findByRole('heading', { name: 'Nada encontrado para «botox»' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Ver todos os serviços' }))
    expect(await screen.findByRole('button', { name: /Limpeza de pele/ })).toBeTruthy()
    expect((box as HTMLInputElement).value).toBe('')
  })

  it('pesquisa de zona dentro do serviço filtra a lista e mantém as escolhidas', async () => {
    mockApi()
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Depilação a laser/ }))
    await user.click(screen.getByLabelText('Axilas'))
    await user.type(screen.getByRole('searchbox', { name: 'Procurar zona' }), 'virilh')
    expect(screen.queryByLabelText('Axilas')).toBeNull()
    expect(screen.getByLabelText('Virilha')).toBeTruthy()
    // O combo «Axilas + virilha» também casa por «virilh».
    expect(screen.getByLabelText('Combo Axilas + virilha')).toBeTruthy()
    await user.clear(screen.getByRole('searchbox', { name: 'Procurar zona' }))
    expect((screen.getByLabelText('Axilas') as HTMLInputElement).checked).toBe(true)
  })

  it('calendário do mês: abre, mostra dias livres, escolhe o dia e fecha com Escape', async () => {
    const calls = mockApi()
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    await screen.findByRole('button', { name: '14:15' })
    await user.click(screen.getByRole('button', { name: /novembro de 2026/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Escolher data' })
    const free = await within(dialog).findByRole('button', { name: 'qui 19/11, com horários' })
    expect(within(dialog).getByLabelText('sex 20/11, sem horários')).toBeTruthy()
    const daysCall = calls.filter((c) => c.url.endsWith('/api/c/availability')).pop()!
    expect(daysCall.body).toMatchObject({ daysOnly: true, from: '2026-11-17', to: '2026-12-16' })
    await user.click(free)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByRole('button', { name: '10:00' })).toBeTruthy()
    // Escape fecha.
    await user.click(screen.getByRole('button', { name: /novembro de 2026/i }))
    await screen.findByRole('dialog', { name: 'Escolher data' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('calendário: «Primeira data livre», mês seguinte só até ao horizonte e sem violações (axe)', async () => {
    mockApi()
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    await screen.findByRole('button', { name: '14:15' })
    await user.click(screen.getByRole('button', { name: /novembro de 2026/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Escolher data' })
    await within(dialog).findByRole('button', { name: /Primeira data livre: qua 18\/11/ })
    expect((within(dialog).getByRole('button', { name: 'Mês anterior' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: 'Próximo mês' }))
    expect(within(dialog).getByText('dezembro 2026')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Próximo mês' }) as HTMLButtonElement).disabled).toBe(true)
    const res = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })
    expect(res.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([])
    await user.click(within(dialog).getByRole('button', { name: /Primeira data livre/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
