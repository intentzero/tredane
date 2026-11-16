import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../ui/panel.css'
import { writeSynthUserId } from '../panel/auth/session'
import type { SupportItem } from './api'
import { AdminApp } from './AdminApp'

const NOW = Date.now()
const MIN = 60_000
const H = 60 * MIN
const person = (id: string, name: string | null = null) => ({ clerkUserId: id, displayName: name, email: null })

const item = (over: Partial<SupportItem> & Pick<SupportItem, 'requestId' | 'state'>): SupportItem => ({
  tenantId: 'aurora',
  tenantName: 'Clínica Aurora',
  actor: person('u_super', 'Operador Tredane'),
  subject: person('u_ana', 'Ana Souza'),
  decider: null,
  revokedBy: null,
  reason: 'Serviço sem zonas não aparece',
  scope: 'read_diagnostics',
  createdAt: NOW - 2 * H,
  decidedAt: null,
  expiresAt: NOW + 21 * H,
  sessionId: null,
  activatedAt: null,
  endedAt: null,
  durationMs: null,
  remainingMs: null,
  ...over,
})

function seed(): SupportItem[] {
  return [
    item({ requestId: 'r1', state: 'awaiting_owner', tenantId: 'lume', tenantName: 'Espaço Lume', reason: 'WhatsApp não recebe', subject: person('u_bia', 'Beatriz Lima'), remainingMs: 21 * H }),
    item({ requestId: 'r2', state: 'approved', decider: person('u_ana', 'Ana Souza'), decidedAt: NOW - 30 * MIN }),
    item({ requestId: 'r3', state: 'active', tenantId: 'vila', tenantName: 'Studio Vila Nova', subject: person('u_carla', 'Carla Mendes'), decider: person('u_carla', 'Carla Mendes'), reason: 'Agenda não mostra sala 2', sessionId: 's3', activatedAt: NOW - 12 * MIN, expiresAt: NOW + 18 * MIN, remainingMs: 18 * MIN }),
    item({ requestId: 'r4', state: 'session_expired', tenantId: 'bem', tenantName: 'Bem Estar Centro', sessionId: 's4', durationMs: 30 * MIN, reason: 'Revisar importação' }),
    item({ requestId: 'r5', state: 'rejected', decider: person('u_ana', 'Ana Souza'), decidedAt: NOW - 20 * H, reason: 'Teste rejeitado' }),
    item({ requestId: 'r6', state: 'revoked', revokedBy: person('u_ana', 'Ana Souza'), sessionId: 's6', durationMs: 9 * MIN, reason: 'Revogada pela owner' }),
    item({ requestId: 'r7', state: 'ended', sessionId: 's7', durationMs: 12 * MIN, reason: 'Encerrada pelo operador' }),
    item({ requestId: 'r8', state: 'request_expired', reason: 'Ninguém decidiu' }),
  ]
}

type Server = {
  items: SupportItem[]
  requests: Array<{ method: string; url: string; body: unknown }>
  failNext: { status: number; error: string } | null
  listFails: number
  owners: Record<string, number>
}

const MEMBERS: Record<string, Array<{ id: string; name: string | null; email: string | null; role: string; status: string }>> = {
  aurora: [
    { id: 'u_ana', name: 'Ana Souza', email: 'ana@example.test', role: 'owner', status: 'active' },
    { id: 'u_helena', name: null, email: 'helena@example.test', role: 'attendant', status: 'active' },
    { id: 'u_old', name: 'Antigo', email: null, role: 'attendant', status: 'revoked' },
  ],
  lume: [{ id: 'u_bia', name: 'Beatriz Lima', email: null, role: 'owner', status: 'active' }],
}

function mount(items: SupportItem[], owners: Record<string, number> = { aurora: 1, lume: 1, vila: 1, bem: 1 }): Server {
  const server: Server = { items, requests: [], failNext: null, listFails: 0, owners }
  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (url.includes('/api/auth/client-config')) return j({ authMode: 'synthetic', clerkPublishableKey: null })
      if (url.endsWith('/api/me')) return j({ kind: 'human', clerkUserId: 'u', sessionId: 's', isSuperadmin: true })
      server.requests.push({ method, url, body })
      if (url === '/api/platform/support' && method === 'GET') {
        if (server.listFails > 0) {
          server.listFails -= 1
          return j({ error: 'boom' }, 503)
        }
        return j({ items: server.items, clinicalAccess: false })
      }
      if (url === '/api/platform/support-requests' && method === 'POST') {
        if (server.failNext) {
          const f = server.failNext
          server.failNext = null
          return j({ error: f.error }, f.status)
        }
        return j({ request: { id: 'new1' }, emailsSent: 1, accessGranted: false }, 201)
      }
      if (url === '/api/platform/tenants') {
        return j({
          tenants: ['aurora', 'lume', 'vila', 'bem', 'jardim'].map((id) => ({
            id,
            name: { aurora: 'Clínica Aurora', lume: 'Espaço Lume', vila: 'Studio Vila Nova', bem: 'Bem Estar Centro', jardim: 'Clínica Jardim Sul' }[id],
            timezone: 'America/Sao_Paulo',
            status: id === 'bem' ? 'suspended' : 'active',
            createdAt: 1,
            updatedAt: 1,
            suspendedAt: null,
            pendingDeletionAt: null,
            ownerCount: id === 'jardim' ? 0 : (server.owners[id] ?? 1),
            memberCount: 2,
            whatsapp: { status: 'connected' },
          })),
        })
      }
      const sm = /^\/api\/platform\/tenants\/([^/]+)\/support$/.exec(url)
      if (sm) {
        const tid = decodeURIComponent(sm[1]!)
        return j({ items: server.items.filter((i) => i.tenantId === tid), clinicalAccess: false })
      }
      const mm = /^\/api\/platform\/tenants\/([^/]+)\/members$/.exec(url)
      if (mm) {
        const tid = decodeURIComponent(mm[1]!)
        return j({
          tenantId: tid,
          members: (MEMBERS[tid] ?? []).map((m) => ({
            tenantId: tid,
            clerkUserId: m.id,
            role: m.role,
            status: m.status,
            createdAt: 1,
            revokedAt: null,
            displayName: m.name,
            email: m.email,
          })),
          clinicalAccess: false,
        })
      }
      const dm = /^\/api\/platform\/tenants\/([^/]+)$/.exec(url)
      if (dm) {
        const tid = decodeURIComponent(dm[1]!)
        const owners = server.owners[tid] ?? 0
        return j({
          tenant: { id: tid, name: tid === 'aurora' ? 'Clínica Aurora' : tid, timezone: 'America/Sao_Paulo', status: 'active', createdAt: 1, updatedAt: 1, suspendedAt: null, pendingDeletionAt: null },
          members: [],
          owners: Array.from({ length: owners }, (_, i) => ({ tenantId: tid, clerkUserId: `o${i}`, role: 'owner', status: 'active', createdAt: 1, revokedAt: null })),
          integration: { whatsapp: { status: 'connected', note: 'n' }, pix: { status: 'not_configured', note: 'x' } },
          deletionCommand: null,
          invitations: [],
          clinicalAccess: false,
        })
      }
      return j({ error: 'not_found' }, 404)
    }),
  )
  return server
}

async function open(path: string) {
  window.history.replaceState(null, '', path)
  return render(<AdminApp />)
}
async function checkA11y(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
}
const rowOf = (table: HTMLElement, text: string) =>
  within(table).getAllByRole('row').find((r) => r.textContent?.includes(text))!

describe('Platform Admin — suporte (#831)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    writeSynthUserId('user_synth_superadmin')
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  describe('PA-05 suporte global', () => {
    it('lista todos os estados com pílula, quem decidiu e prazo ou duração', async () => {
      mount(seed())
      const { container } = await open('/admin/suporte')
      const table = await screen.findByRole('table')
      const state = (reason: string, label: string) => within(rowOf(table, reason)).getByText(label, { selector: '.admin-pill' })
      state('WhatsApp não recebe', 'Aguarda owner')
      expect(rowOf(table, 'WhatsApp não recebe').textContent).toContain('expira em 21 h')
      expect(rowOf(table, 'Serviço sem zonas').textContent).toContain('por Ana Souza')
      state('Serviço sem zonas', 'Aprovado')
      state('Agenda não mostra sala 2', 'Ativa')
      expect(rowOf(table, 'Agenda não mostra sala 2').textContent).toContain('restam 18 min')
      state('Revisar importação', 'Expirou')
      expect(rowOf(table, 'Revisar importação').textContent).toContain('30 min')
      state('Teste rejeitado', 'Rejeitado')
      state('Revogada pela owner', 'Revogada')
      expect(rowOf(table, 'Revogada pela owner').textContent).toContain('por Ana Souza')
      expect(rowOf(table, 'Revogada pela owner').textContent).toContain('9 min')
      state('Encerrada pelo operador', 'Encerrada')
      expect(rowOf(table, 'Encerrada pelo operador').textContent).toContain('pelo operador')
      state('Ninguém decidiu', 'Pedido expirou')
      await checkA11y(container)
    })

    it('uma sessão ativa aparece em destaque com o tempo que resta e a regra dos 30 minutos', async () => {
      mount(seed())
      await open('/admin/suporte')
      const card = await screen.findByRole('region', { name: 'Sessão ativa · Studio Vila Nova' })
      expect(card.textContent).toContain('Em nome de Carla Mendes')
      expect(card.textContent).toContain('Restam 18 min de 30 minutos')
      expect(card.textContent).toContain('faça um novo pedido')
    })

    it('filtros Todos, Abertos e Encerrados com contadores', async () => {
      mount(seed())
      const user = userEvent.setup()
      await open('/admin/suporte')
      const group = await screen.findByRole('group', { name: 'Filtro' })
      expect(within(group).getByRole('button', { name: 'Todos 8' })).toBeTruthy()
      expect(within(group).getByRole('button', { name: 'Abertos 3' })).toBeTruthy()
      expect(within(group).getByRole('button', { name: 'Encerrados 5' })).toBeTruthy()
      await user.click(within(group).getByRole('button', { name: 'Abertos 3' }))
      expect(within(screen.getByRole('table')).getAllByRole('row').slice(1)).toHaveLength(3)
      await user.click(within(group).getByRole('button', { name: 'Encerrados 5' }))
      expect(within(screen.getByRole('table')).getAllByRole('row').slice(1)).toHaveLength(5)
    })

    it('não oferece botões que o servidor não suporta e diz o que falta', async () => {
      mount(seed())
      await open('/admin/suporte')
      const table = await screen.findByRole('table')
      expect(within(table).queryByRole('button')).toBeNull()
      expect(screen.queryByRole('button', { name: /Entrar|Encerrar|Cancelar pedido/ })).toBeNull()
      expect(screen.getByText(/Ativar, entrar e encerrar uma sessão ainda não estão disponíveis/)).toBeTruthy()
    })

    it('o nome da clínica leva à aba Suporte dela', async () => {
      mount(seed())
      const user = userEvent.setup()
      await open('/admin/suporte')
      await user.click(await screen.findByRole('link', { name: 'Espaço Lume' }))
      expect(window.location.pathname).toBe('/admin/clinicas/lume/suporte')
    })

    it('vazio, erro com «Tentar de novo» e filtro sem resultados', async () => {
      mount([])
      await open('/admin/suporte')
      expect(await screen.findByText('Ainda não há pedidos de suporte')).toBeTruthy()
      cleanup()
      const server = mount(seed())
      server.listFails = 1
      const user = userEvent.setup()
      await open('/admin/suporte')
      expect(await screen.findByText('Não foi possível carregar o suporte')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
      expect(await screen.findByRole('table')).toBeTruthy()
      cleanup()
      mount([item({ requestId: 'x', state: 'rejected' })])
      await open('/admin/suporte')
      await user.click(await screen.findByRole('button', { name: 'Abertos 0' }))
      expect(await screen.findByText('Nenhum pedido neste filtro')).toBeTruthy()
    })
  })

  describe('Pedir suporte', () => {
    it('global: escolhe clínica e pessoa (só membros ativos), exige motivo e envia o pedido de leitura', async () => {
      const server = mount(seed())
      const user = userEvent.setup()
      await open('/admin/suporte')
      await user.click(await screen.findByRole('button', { name: 'Pedir suporte' }))
      const dialog = await screen.findByRole('dialog')
      const clinic = within(dialog).getByLabelText('Clínica')
      // Só clínicas ativas e com owner ativa: sem a suspensa nem a sem owner.
      expect(within(clinic).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Escolher…',
        'Clínica Aurora',
        'Espaço Lume',
        'Studio Vila Nova',
      ])
      await user.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }))
      expect(await within(dialog).findByText('Escolha a clínica.')).toBeTruthy()
      expect(server.requests.some((r) => r.url === '/api/platform/support-requests')).toBe(false)

      await user.selectOptions(clinic, 'aurora')
      const subject = await within(dialog).findByLabelText(/Em nome de/)
      await waitFor(() => expect((subject as unknown as { disabled: boolean }).disabled).toBe(false))
      expect(within(subject).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Escolher…',
        'Ana Souza · owner',
        'helena@example.test · attendant',
      ])
      await user.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }))
      expect(await within(dialog).findByText(/Escolha a pessoa/)).toBeTruthy()
      await user.selectOptions(subject, 'u_helena')
      await user.type(within(dialog).getByLabelText(/Motivo/), '  agenda sem sala  ')
      await user.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(server.requests.find((r) => r.url === '/api/platform/support-requests')?.body).toEqual({
        tenantId: 'aurora',
        subjectClerkUserId: 'u_helena',
        reason: 'agenda sem sala',
        scope: 'read_diagnostics',
      })
      expect(await screen.findByText(/uma owner de Clínica Aurora tem de aprovar/)).toBeTruthy()
    })

    it('motivo curto é recusado no cliente e o servidor pode recusar com uma frase', async () => {
      const server = mount(seed())
      server.failNext = { status: 403, error: 'no_active_owner' }
      const user = userEvent.setup()
      await open('/admin/clinicas/aurora/suporte')
      await user.click(await screen.findByRole('button', { name: 'Pedir suporte' }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog.textContent).toContain('Pedir suporte · Clínica Aurora')
      const subject = within(dialog).getByLabelText(/Em nome de/)
      await waitFor(() => expect((subject as unknown as { disabled: boolean }).disabled).toBe(false))
      await user.selectOptions(subject, 'u_ana')
      await user.type(within(dialog).getByLabelText(/Motivo/), 'ok')
      await user.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }))
      expect(await within(dialog).findByText(/pelo menos 3 caracteres/)).toBeTruthy()
      expect(server.requests.some((r) => r.url === '/api/platform/support-requests')).toBe(false)
      await user.type(within(dialog).getByLabelText(/Motivo/), 'k verificar')
      await user.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }))
      expect(await within(dialog).findByText('Esta clínica ainda não tem owner ativa: ninguém pode aprovar o acesso.')).toBeTruthy()
      expect(dialog.textContent).not.toContain('no_active_owner')
      expect(screen.getByRole('dialog')).toBeTruthy()
    })

    it('acessibilidade do diálogo', async () => {
      mount(seed())
      const user = userEvent.setup()
      await open('/admin/suporte')
      await user.click(await screen.findByRole('button', { name: 'Pedir suporte' }))
      await screen.findByRole('dialog')
      await checkA11y(document.body)
    })
  })

  describe('PA-10 aba Suporte da clínica', () => {
    it('só os pedidos desta clínica, sem coluna de clínica, e o botão Pedir suporte', async () => {
      mount(seed())
      const { container } = await open('/admin/clinicas/aurora/suporte')
      const table = await screen.findByRole('table')
      const rows = within(table).getAllByRole('row').slice(1)
      expect(rows.length).toBe(seed().filter((i) => i.tenantId === 'aurora').length)
      expect(within(table).queryByText('Espaço Lume')).toBeNull()
      expect(within(table).getByRole('columnheader', { name: 'Pedido em' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Pedir suporte' })).toBeTruthy()
      await checkA11y(container)
    })

    it('clínica sem owner ativa não deixa pedir e diz porquê', async () => {
      mount(seed(), { aurora: 0 })
      await open('/admin/clinicas/aurora/suporte')
      expect(await screen.findByText(/ainda não tem owner ativa: ninguém pode aprovar/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Pedir suporte' })).toBeNull()
    })

    it('sem pedidos mostra a frase vazia; com sessão ativa mostra o destaque', async () => {
      mount([])
      await open('/admin/clinicas/aurora/suporte')
      expect(await screen.findByText('Sem pedidos de suporte')).toBeTruthy()
      cleanup()
      mount(seed().map((i) => ({ ...i, tenantId: 'aurora', tenantName: 'Clínica Aurora' })))
      await open('/admin/clinicas/aurora/suporte')
      const card = await screen.findByRole('region', { name: 'Sessão ativa' })
      expect(card.textContent).toContain('Carla Mendes')
      expect(screen.getByText(/Sessão ativa agora · restam 18 min/)).toBeTruthy()
    })
  })

  describe('PA-01 visão geral', () => {
    it('mostra os pedidos em aberto com estado e prazo, e aponta para o suporte', async () => {
      const server = mount(seed())
      // Visão geral também lê a saúde: responde vazio.
      const real = globalThis.fetch
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === '/api/platform/health') {
          return new Response(JSON.stringify({ summaryAt: null, refreshIntervalMs: 600000, totals: { activeClinics: 0, critical: 0, attention: 0, normal: 0, noData: 0, unreachable: 0, llmJobsOpen: 0 }, clinics: [] }), { status: 200 })
        }
        return real(input, init)
      }))
      await open('/admin')
      const card = await screen.findByRole('heading', { name: 'Suporte' })
      const section = card.closest('section')!
      expect(within(section).getByText('Aguarda owner')).toBeTruthy()
      expect(within(section).getByText('Ativa')).toBeTruthy()
      expect(within(section).getByRole('link', { name: 'Abrir suporte' })).toBeTruthy()
      expect(server.requests.some((r) => r.url === '/api/platform/support')).toBe(true)
    })
  })
})
