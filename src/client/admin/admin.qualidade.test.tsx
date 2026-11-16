import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../ui/panel.css'
import { writeSynthUserId } from '../panel/auth/session'
import type { QualityMetrics, SampleDetail, SampleItem, ShadowReport } from './api'
import { AdminApp } from './AdminApp'

const NOW = Date.now()

const metrics = (over: Partial<QualityMetrics> = {}): QualityMetrics => ({
  bookingRate: { episodesWithIntent: 100, confirmed: 63, rate: 0.63 },
  falseConfirmations: { count: 0, ids: [] },
  attendantCalls: { episodesWithRequest: 11, episodesTotal: 100, rate: 0.11 },
  abandonedConversations: { count: 9 },
  messagesToBook: { median: 5, samples: 63, baseline: 6 },
  misunderstandingsPerConversation: { mean: 0.4, totalTurns: 40, episodes: 100 },
  attendance: { aiBooked: 20, fulfilled: 15, fulfillmentRate: 0.75, note: 'x' },
  blindSpots: ['Não vê conversas que nunca abriram um episódio de marcação.'],
  ...over,
})

const shadowReport = (over: Partial<ShadowReport> = {}): ShadowReport => ({
  temporary: true,
  window: { sinceHours: 168, requestedHours: 168, clamped: false },
  truncated: false,
  summary: {
    total: 1284,
    conversations: 300,
    fields: {
      service: { agree: 81, differ: 5, llm_only: 14, rule_only: 0, none: 900 },
      period: { agree: 74, differ: 9, llm_only: 17, rule_only: 0, none: 800 },
    },
  },
  ...over,
})

const item = (n: number, over: Partial<SampleItem> = {}): SampleItem => ({
  id: `rs_${n}`,
  tenantId: 'aurora',
  tenantName: 'Clínica Aurora',
  conversationId: `cnv_${n}`,
  contactDisplayName: 'Ana Exemplo',
  contactPhoneMasked: '••••0001',
  flagSource: 'client',
  flagReason: 'nao_encontrei',
  clientComment: null,
  clientComments: [],
  flaggedAt: NOW - n * 60_000,
  expiresAt: NOW + 30 * 86_400_000,
  messageCount: 2,
  lastMessageAt: NOW - n * 60_000,
  lastMessagePreview: 'Não encontrei cotovelo',
  ...over,
})

type Server = {
  metrics: QualityMetrics
  shadow: ShadowReport
  samples: SampleItem[]
  requests: string[]
  failMetrics: boolean
  failSample: boolean
  detail: Partial<SampleDetail>
}

function mount(over: Partial<Server> = {}): Server {
  const server: Server = {
    metrics: metrics(),
    shadow: shadowReport(),
    samples: [item(1), item(2, { flagSource: 'auto', tenantId: 'lume', tenantName: 'Espaço Lume', contactDisplayName: null })],
    requests: [],
    failMetrics: false,
    failSample: false,
    detail: {},
    ...over,
  }
  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/client-config')) return j({ authMode: 'synthetic', clerkPublishableKey: null })
      if (url.endsWith('/api/me')) return j({ kind: 'human', clerkUserId: 'u', sessionId: 's', isSuperadmin: true })
      if (url === '/api/platform/tenants') {
        return j({
          tenants: [
            { id: 'aurora', name: 'Clínica Aurora', timezone: 'x', status: 'active', createdAt: 1, updatedAt: 1, suspendedAt: null, pendingDeletionAt: null, ownerCount: 1, memberCount: 1, whatsapp: { status: 'connected' } },
            { id: 'lume', name: 'Espaço Lume', timezone: 'x', status: 'active', createdAt: 1, updatedAt: 1, suspendedAt: null, pendingDeletionAt: null, ownerCount: 1, memberCount: 1, whatsapp: { status: 'connected' } },
          ],
        })
      }
      server.requests.push(url)
      if (url.startsWith('/api/platform/quality/metrics')) {
        if (server.failMetrics) {
          server.failMetrics = false
          return j({ error: 'boom' }, 503)
        }
        return j({ metrics: server.metrics, clinicalAccess: false })
      }
      if (url.startsWith('/api/platform/quality/shadow')) return j(server.shadow)
      const sm = /^\/api\/platform\/quality\/samples\/([^/?]+)$/.exec(url)
      if (sm) {
        if (server.failSample) return j({ error: 'review_sample_not_found' }, 404)
        const base = server.samples.find((s) => s.id === sm[1])!
        return j({
          sample: {
            ...base,
            messages: [
              { id: 'a', seq: 1, direction: 'inbound', body: 'quero cotovelo', createdAt: NOW - 120_000, deliveryState: 'delivered', authorDisplayName: null },
              { id: 'b', seq: 2, direction: 'outbound', body: 'Não encontrei cotovelo nas opções.', createdAt: NOW - 60_000, deliveryState: 'sent', authorDisplayName: 'Helena' },
            ],
            ...server.detail,
          },
        })
      }
      if (url.startsWith('/api/platform/quality/samples')) {
        const q = new URLSearchParams(url.split('?')[1] ?? '')
        const t = q.get('tenantId')
        const before = q.get('before')
        const list = server.samples.filter((s) => !t || s.tenantId === t)
        const items = before ? list.filter((s) => s.flaggedAt < Number(before)) : list.slice(0, Number(q.get('limit') ?? 20))
        return j({ samples: items, nextBefore: !before && list.length > Number(q.get('limit') ?? 20) ? list[Number(q.get('limit') ?? 20) - 1]!.flaggedAt : null })
      }
      return j({ error: 'not_found' }, 404)
    }),
  )
  return server
}

async function open(path = '/admin/qualidade-ia') {
  window.history.replaceState(null, '', path)
  return render(<AdminApp />)
}
async function checkA11y(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
}
const stat = (label: RegExp | string) => screen.getByText(label, { selector: '.admin-stat span' }).previousElementSibling!

describe('Platform Admin — qualidade da IA (#834, AC-86)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    writeSynthUserId('user_synth_superadmin')
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('cartões com as métricas do servidor (mesmos números do MCP) e o que elas não veem', async () => {
    mount()
    const { container } = await open()
    await screen.findByText(/Conversas de marcação/)
    expect(stat('Conversas de marcação').textContent).toBe('100')
    expect(stat(/Chegaram a horário confirmado/).textContent).toBe('63 %')
    expect(screen.getByText(/63 de 100/)).toBeTruthy()
    expect(stat(/Pediram a equipe/).textContent).toBe('11 %')
    expect(stat(/Falsas confirmações/).textContent).toBe('0')
    expect(stat(/Mensagens até marcar/).textContent).toBe('5')
    expect(screen.getByText(/referência 6/)).toBeTruthy()
    expect(stat('Incompreensões por conversa').textContent).toBe('0.40')
    expect(stat(/Comparecimento das marcações da IA/).textContent).toBe('75 %')
    expect(screen.getByText('O que estas métricas não veem')).toBeTruthy()
    await checkA11y(container)
  })

  it('falsa confirmação é a linha vermelha: destaca-se quando é maior que 0', async () => {
    mount({ metrics: metrics({ falseConfirmations: { count: 2, ids: ['a', 'b'] } }) })
    await open()
    await screen.findByText(/Conversas de marcação/)
    expect(within(stat(/Falsas confirmações/) as HTMLElement).getByText('2', { selector: '.admin-pill' })).toBeTruthy()
  })

  it('sem episódios: taxas mostram «—», sem inventar zero', async () => {
    mount({
      metrics: metrics({
        bookingRate: { episodesWithIntent: 0, confirmed: 0, rate: null },
        attendantCalls: { episodesWithRequest: 0, episodesTotal: 0, rate: null },
        messagesToBook: { median: null, samples: 0, baseline: 6 },
        misunderstandingsPerConversation: { mean: null, totalTurns: 0, episodes: 0 },
        attendance: { aiBooked: 0, fulfilled: 0, fulfillmentRate: null, note: '' },
        blindSpots: [],
      }),
    })
    await open()
    await screen.findByText(/Conversas de marcação/)
    expect(stat(/Chegaram a horário confirmado/).textContent).toBe('—')
    expect(stat(/Mensagens até marcar/).textContent).toBe('—')
    expect(stat('Incompreensões por conversa').textContent).toBe('—')
    expect(screen.queryByText('O que estas métricas não veem')).toBeNull()
  })

  it('sombra: percentagens por campo sobre os turnos medidos, marcada como temporária', async () => {
    mount()
    await open()
    const heading = await screen.findByRole('heading', { name: /Sombra do interpretador/ })
    const section = heading.closest('section')!
    expect(within(section).getByText('Temporário')).toBeTruthy()
    const service = (await within(section).findByText('Serviço')).closest('tr')!
    // 81 + 5 + 14 = 100 medidos → 81 %, 5 %, 14 %, 0 %.
    expect(service.textContent).toContain('81 %')
    expect(service.textContent).toContain('5 %')
    expect(service.textContent).toContain('14 %')
    expect(section.textContent).toContain('1284 turnos em 300 conversas')
    expect(section.textContent).toContain('não dizem quem tem razão')
  })

  it('sombra: avisa quando o período foi limitado a 7 dias e quando o resumo foi truncado', async () => {
    mount({ shadow: shadowReport({ window: { sinceHours: 168, requestedHours: 720, clamped: true }, truncated: true }) })
    await open()
    expect(await screen.findByText(/A sombra só guarda 7 dias: mostra os últimos 7 dias/)).toBeTruthy()
    expect(screen.getByText(/Resumo truncado/)).toBeTruthy()
  })

  it('sombra sem turnos diz isso', async () => {
    mount({ shadow: shadowReport({ summary: { total: 0, conversations: 0, fields: {} } }) })
    await open()
    expect(await screen.findByText('Sem turnos medidos neste período.')).toBeTruthy()
  })

  it('o período e a clínica mudam as consultas (7 dias por omissão)', async () => {
    const server = mount()
    const user = userEvent.setup()
    await open()
    await screen.findByText(/Conversas de marcação/)
    expect(server.requests.some((u) => u.includes('metrics?sinceHours=168'))).toBe(true)
    await user.click(screen.getByRole('button', { name: '30 dias' }))
    await waitFor(() => expect(server.requests.some((u) => u.includes('metrics?sinceHours=720'))).toBe(true))
    expect(server.requests.some((u) => u.includes('shadow?sinceHours=720'))).toBe(true)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Clínica' }), 'lume')
    await waitFor(() => expect(server.requests.some((u) => u.includes('metrics?sinceHours=720&tenantId=lume'))).toBe(true))
    await waitFor(() => expect(server.requests.some((u) => u.includes('samples?tenantId=lume'))).toBe(true))
  })

  it('amostras: telefone mascarado, origem, motivo e nunca o número completo', async () => {
    mount()
    await open()
    const heading = await screen.findByRole('heading', { name: 'Amostras para revisão' })
    const section = heading.closest('section')!
    const table = await within(section).findByRole('table')
    expect(within(table).getByText(/Ana Exemplo · ••••0001/)).toBeTruthy()
    expect(within(table).getByText(/Cliente · ••••0001/)).toBeTruthy()
    expect(within(table).getByText('Automática')).toBeTruthy()
    expect(section.textContent).toContain('fica registado na auditoria')
    expect(document.body.textContent).not.toMatch(/5511\d{4}0001/)
  })

  it('abrir uma amostra mostra o texto da conversa com quem disse o quê e os comentários da cliente', async () => {
    const server = mount({ detail: { clientComments: ['o sistema travou', 'pedi a equipe e nada'] } })
    const user = userEvent.setup()
    await open()
    await user.click(await screen.findByRole('button', { name: /Ana Exemplo · ••••0001/ }))
    const dialog = await screen.findByRole('dialog')
    const thread = await within(dialog).findByRole('list', { name: 'Mensagens' })
    expect(within(thread).getByText('quero cotovelo')).toBeTruthy()
    expect(within(thread).getByText('Não encontrei cotovelo nas opções.')).toBeTruthy()
    expect(thread.textContent).toContain('Cliente')
    expect(thread.textContent).toContain('Clínica · Helena')
    expect(within(dialog).getByRole('region', { name: 'Comentários da cliente' }).textContent).toContain('pedi a equipe e nada')
    expect(dialog.textContent).toContain('Texto de conversa real')
    expect(dialog.textContent).toContain('30 dias')
    expect(server.requests.filter((u) => u.endsWith('/samples/rs_1'))).toHaveLength(1)
    await checkA11y(document.body)
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('amostra que já expirou mostra a frase e não a conversa', async () => {
    mount({ failSample: true })
    const user = userEvent.setup()
    await open()
    await user.click(await screen.findByRole('button', { name: /Ana Exemplo/ }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/já não existe \(a retenção é de 30 dias\)/)).toBeTruthy()
    expect(within(dialog).queryByRole('list', { name: 'Mensagens' })).toBeNull()
  })

  it('«Carregar mais» pede a página seguinte e some quando acaba', async () => {
    const many = Array.from({ length: 25 }, (_, i) => item(i + 1, { id: `rs_${i + 1}`, contactDisplayName: `Pessoa ${i + 1}` }))
    const server = mount({ samples: many })
    const user = userEvent.setup()
    await open()
    const heading = await screen.findByRole('heading', { name: 'Amostras para revisão' })
    const section = heading.closest('section')!
    await within(section).findByRole('table')
    expect(within(section).getAllByRole('row').slice(1)).toHaveLength(20)
    await user.click(within(section).getByRole('button', { name: 'Carregar mais' }))
    await waitFor(() => expect(within(section).getAllByRole('row').slice(1)).toHaveLength(25))
    expect(within(section).queryByRole('button', { name: 'Carregar mais' })).toBeNull()
    expect(server.requests.some((u) => u.includes('before='))).toBe(true)
  })

  it('sem amostras mostra a frase vazia; erro nas métricas permite tentar de novo sem apagar o resto', async () => {
    mount({ samples: [] })
    await open()
    expect(await screen.findByText('Sem amostras')).toBeTruthy()
    cleanup()
    const server = mount({ failMetrics: true })
    const user = userEvent.setup()
    await open()
    expect(await screen.findByText('Não foi possível carregar as métricas')).toBeTruthy()
    // As outras partes continuam disponíveis.
    expect(await screen.findByRole('heading', { name: 'Amostras para revisão' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await screen.findByText(/Conversas de marcação/)
    expect(server.requests.filter((u) => u.includes('metrics')).length).toBe(2)
  })
})
