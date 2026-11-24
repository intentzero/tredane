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

type PickBody = Record<string, unknown>

/** Resposta de «Quando prefere?»: 3 horas por pedido; «Outros horários» (offset 3) traz mais 3 e acaba. */
function defaultPick(body: PickBody) {
  const when = body.when as string | { date: string }
  const date = typeof when === 'object' ? when.date : when === 'amanha' ? '2026-11-18' : '2026-11-17'
  const first = typeof when === 'object' ? ['10:00', '11:00', '15:00'] : ['09:00', '14:15', '16:30']
  const times = body.offset === 3 ? ['12:00', '12:30', '13:00'] : first
  return {
    date,
    slots: times.map((t) => ({ id: `${date}T${t}`, date, time: t })),
    hasMore: body.offset !== 3,
    earliestPossible: null,
    emptyReason: null,
    nextAvailable: null,
    chips: body.wantChips ? { agora: true, hojeManha: true, hojeTarde: true } : null,
  }
}

function mockApi(
  opts: {
    book?: unknown
    bookStatus?: number
    slots?: unknown[]
    exchange?: unknown
    pick?: (body: PickBody) => unknown
  } = {},
) {
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
        if (body && 'when' in body) return json((opts.pick ?? defaultPick)(body))
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
      slotId: '2026-11-17T14:15',
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

  const picks = (calls: Calls) =>
    calls.filter((c) => c.url.endsWith('/api/c/availability') && c.body && 'when' in c.body)

  it('Quando prefere? (DEC-227): 3 horas por pedido; «Outros horários» acrescenta sem repetir; nunca a grade inteira', async () => {
    const calls = mockApi()
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    expect(await screen.findByText('Quando prefere?')).toBeTruthy()
    await screen.findByRole('button', { name: '14:15' })
    expect(picks(calls)[0]!.body).toMatchObject({ when: 'agora', wantChips: true, offset: 0 })
    expect(document.querySelectorAll('.cw-time')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Semana anterior' })).toBeNull()
    expect(screen.getByText('Hoje, terça 17')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Outros horários/ }))
    await screen.findByRole('button', { name: '12:30' })
    expect(document.querySelectorAll('.cw-time')).toHaveLength(6)
    expect(picks(calls).pop()!.body).toMatchObject({ when: 'agora', offset: 3 })
    expect(screen.queryByRole('button', { name: /Outros horários/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Amanhã' }))
    await waitFor(() => expect(picks(calls).pop()!.body).toMatchObject({ when: 'amanha', offset: 0 }))
    expect(await screen.findByText('Amanhã, quarta 18')).toBeTruthy()
    expect(document.querySelectorAll('.cw-time')).toHaveLength(3)
  })

  it('chips de hoje sem vaga não aparecem; sem pedido do chat abre na primeira conveniência com vaga', async () => {
    const calls = mockApi({
      pick: (body) => ({
        ...defaultPick(body),
        chips: body.wantChips ? { agora: false, hojeManha: false, hojeTarde: true } : null,
      }),
    })
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    await waitFor(() => expect(picks(calls).some((c) => c.body!.when === 'hoje_tarde')).toBe(true))
    expect(screen.queryByRole('button', { name: 'Agora' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hoje de manhã' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Hoje à tarde' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Amanhã' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Outra data' })).toBeTruthy()
  })

  it('a antecedência mínima só é explicada quando corta a primeira hora', async () => {
    mockApi({ pick: (body) => ({ ...defaultPick(body), earliestPossible: '14:30' }) })
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    expect(await screen.findByText('O mais cedo possível é às 14:30.')).toBeTruthy()
    cleanup()
    resetExchangesForTest()
    window.history.replaceState(null, '', '/c/cw1_exemplo')
    mockApi()
    const user2 = await openBooking()
    await user2.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user2.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    await screen.findByRole('button', { name: '14:15' })
    expect(screen.queryByText(/O mais cedo possível/)).toBeNull()
  })

  it('sem horas na conveniência: motivo e «Próximo livre» que segue para a revisão', async () => {
    mockApi({
      pick: (body) => ({
        ...defaultPick(body),
        slots: [],
        hasMore: false,
        emptyReason: 'full',
        nextAvailable: { id: '2026-11-20T09:30', date: '2026-11-20', time: '09:30' },
      }),
    })
    const user = await openBooking()
    await user.click(await screen.findByRole('button', { name: 'Feminino' }))
    await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
    expect(await screen.findByText('Sem horários nesta altura.')).toBeTruthy()
    expect(document.querySelectorAll('.cw-time')).toHaveLength(0)
    expect(screen.getByText('Nada fica marcado antes de Confirmar.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Próximo livre: sexta 20, 09:30' }))
    expect(await screen.findByRole('heading', { name: 'Confirme o horário' })).toBeTruthy()
  })

  it('motivos de vazio: fechada e período que já passou', async () => {
    for (const [reason, text] of [
      ['closed', 'A clínica está fechada neste dia.'],
      ['past', 'Esse período já passou.'],
    ] as const) {
      cleanup()
      resetExchangesForTest()
      window.history.replaceState(null, '', '/c/cw1_exemplo')
      mockApi({ pick: (body) => ({ ...defaultPick(body), slots: [], hasMore: false, emptyReason: reason }) })
      const user = await openBooking()
      await user.click(await screen.findByRole('button', { name: 'Feminino' }))
      await user.click(await screen.findByRole('button', { name: /Limpeza de pele/ }))
      expect(await screen.findByText(text)).toBeTruthy()
    }
  })

  it('link do chat com data e período abre nessa conveniência (DEC-227)', async () => {
    const calls = mockApi({
      exchange: {
        ok: true,
        purpose: 'agendar',
        appointmentId: null,
        serviceId: 'svc-limpeza',
        preferredDate: '2026-11-19',
        dayPart: 'tarde',
      },
    })
    render(<ClientWebApp />)
    await screen.findByRole('heading', { name: 'Quando?' })
    await waitFor(() => expect(picks(calls).length).toBeGreaterThan(0))
    expect(picks(calls)[0]!.body).toMatchObject({ when: { date: '2026-11-19', dayPart: 'tarde' } })
    expect((await screen.findByRole('button', { name: 'qui 19/11' })).getAttribute('aria-pressed')).toBe('true')
  })

  it('link do chat só com período («de manhã») abre em «Hoje de manhã»', async () => {
    const calls = mockApi({
      exchange: { ok: true, purpose: 'agendar', appointmentId: null, serviceId: 'svc-limpeza', dayPart: 'manha' },
    })
    render(<ClientWebApp />)
    await screen.findByRole('heading', { name: 'Quando?' })
    await waitFor(() => expect(picks(calls).length).toBeGreaterThan(0))
    expect(picks(calls)[0]!.body).toMatchObject({ when: 'hoje_manha' })
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
    await user.click(screen.getByRole('button', { name: 'Outra data' }))
    const dialog = await screen.findByRole('dialog', { name: 'Escolher data' })
    const free = await within(dialog).findByRole('button', { name: 'qui 19/11, com horários' })
    expect(within(dialog).getByLabelText('sex 20/11, sem horários')).toBeTruthy()
    const daysCall = calls.filter((c) => c.url.endsWith('/api/c/availability') && c.body?.daysOnly === true).pop()!
    expect(daysCall.body).toMatchObject({ daysOnly: true, from: '2026-11-17', to: '2026-12-16' })
    // «Tem uma hora em mente?» (opcional, DEC-227) acompanha a data escolhida.
    await user.type(within(dialog).getByLabelText(/Tem uma hora em mente/), '10:15')
    await user.click(free)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByRole('button', { name: '10:00' })).toBeTruthy()
    expect(picks(calls).pop()!.body).toMatchObject({ when: { date: '2026-11-19' }, requestedTime: '10:15' })
    expect(screen.getByRole('button', { name: 'qui 19/11' }).getAttribute('aria-pressed')).toBe('true')
    // Escape fecha.
    await user.click(screen.getByRole('button', { name: 'qui 19/11' }))
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
    await user.click(screen.getByRole('button', { name: 'Outra data' }))
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
