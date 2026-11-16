import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../ui/panel.css'
import { writeSynthUserId } from '../panel/auth/session'
import type { AuditEvent } from './api'
import { AdminApp } from './AdminApp'

const NOW = Date.now()
const person = (id: string, name: string | null = null) => ({ clerkUserId: id, displayName: name, email: null })

const ev = (n: number, over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: `aud_${String(n).padStart(3, '0')}`,
  occurredAt: NOW - n * 60_000,
  action: 'tenant.suspend',
  objectType: 'tenant',
  objectId: 'lume',
  outcome: 'success',
  actor: person('u_super', 'Operador Tredane'),
  subject: null,
  tenantId: 'lume',
  tenantName: 'Espaço Lume',
  supportSessionId: null,
  metadata: {},
  ...over,
})

type Server = {
  all: AuditEvent[]
  requests: string[]
  failOnce: boolean
  failMore: boolean
}

function mount(all: AuditEvent[]): Server {
  const server: Server = { all, requests: [], failOnce: false, failMore: false }
  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/client-config')) return j({ authMode: 'synthetic', clerkPublishableKey: null })
      if (url.endsWith('/api/me')) return j({ kind: 'human', clerkUserId: 'u', sessionId: 's', isSuperadmin: true })
      const am = /^\/api\/platform\/(?:tenants\/([^/]+)\/)?audit(?:\?(.*))?$/.exec(url)
      if (am) {
        server.requests.push(url)
        const q = new URLSearchParams(am[2] ?? '')
        if (server.failOnce && !q.get('cursor')) {
          server.failOnce = false
          return j({ error: 'boom' }, 503)
        }
        if (server.failMore && q.get('cursor')) {
          server.failMore = false
          return j({ error: 'boom' }, 503)
        }
        const prefixes: Record<string, string[]> = { clinic: ['tenant.'], members: ['owner.', 'membership.', 'invitation.'], support: ['support.'], email: ['email.'] }
        const cat = q.get('category')
        const limit = Number(q.get('limit') ?? 50)
        const start = q.get('cursor') ? Number(q.get('cursor')) : 0
        const filtered = server.all.filter((e) => (am[1] ? e.tenantId === decodeURIComponent(am[1]) : true) && (!cat || prefixes[cat]!.some((p) => e.action.startsWith(p))))
        const events = filtered.slice(start, start + limit)
        return j({ events, nextCursor: start + limit < filtered.length ? String(start + limit) : null, clinicalAccess: false })
      }
      const dm = /^\/api\/platform\/tenants\/([^/]+)$/.exec(url)
      if (dm) {
        return j({
          tenant: { id: 'lume', name: 'Espaço Lume', timezone: 'America/Sao_Paulo', status: 'active', createdAt: 1, updatedAt: 1, suspendedAt: null, pendingDeletionAt: null },
          members: [],
          owners: [],
          integration: { whatsapp: { status: 'connected', note: 'n' }, pix: { status: 'not_configured', note: 'x' } },
          deletionCommand: null,
          invitations: [],
          clinicalAccess: false,
        })
      }
      if (url === '/api/platform/tenants') return j({ tenants: [] })
      if (url === '/api/platform/support') return j({ items: [], clinicalAccess: false })
      if (url === '/api/platform/health') {
        return j({ summaryAt: null, refreshIntervalMs: 600000, totals: { activeClinics: 0, critical: 0, attention: 0, normal: 0, noData: 0, unreachable: 0, llmJobsOpen: 0 }, clinics: [] })
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
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

describe('Platform Admin — auditoria (#832)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    writeSynthUserId('user_synth_superadmin')
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  describe('PA-11 aba Auditoria', () => {
    it('eventos com ação em português, ator, alvo e resultado; sessão quando há', async () => {
      mount([
        ev(1, { action: 'support.session.activate', outcome: 'success', subject: person('u_ana', 'Ana Souza'), supportSessionId: 'ss_4d2' }),
        ev(2, { action: 'owner.assign', actor: person('system_cron'), outcome: 'denied' }),
        ev(3, { action: 'email.delivery.sent', outcome: 'error', actor: person('u_x') }),
        ev(4, { action: 'acao.desconhecida', outcome: 'conflict' }),
      ])
      const { container } = await open('/admin/clinicas/lume/auditoria')
      await screen.findByRole('table')
      const [a, b, c, d] = rows()
      expect(a!.textContent).toContain('Ativou sessão de suporte')
      expect(a!.textContent).toContain('Ana Souza')
      expect(a!.textContent).toContain('ss_4d2')
      expect(within(a!).getByText('Feito')).toBeTruthy()
      expect(b!.textContent).toContain('Sistema')
      expect(within(b!).getByText('Negado')).toBeTruthy()
      expect(within(c!).getByText('Falhou')).toBeTruthy()
      // Ação sem rótulo conhecido mostra o nome técnico em vez de esconder o evento.
      expect(d!.textContent).toContain('acao.desconhecida')
      expect(within(d!).getByText('Conflito')).toBeTruthy()
      await checkA11y(container)
    })

    it('a linha expande com a ação técnica, o objeto e os metadados; fecha ao tocar de novo', async () => {
      mount([ev(1, { action: 'tenant.suspend', metadata: { to: 'suspended', reason: 'cobrança em atraso', n: 3, vazio: null } })])
      const user = userEvent.setup()
      await open('/admin/clinicas/lume/auditoria')
      const button = await screen.findByRole('button', { name: 'Suspendeu a clínica' })
      expect(button.getAttribute('aria-expanded')).toBe('false')
      await user.click(button)
      expect(button.getAttribute('aria-expanded')).toBe('true')
      const table = screen.getByRole('table')
      expect(within(table).getByText('tenant.suspend')).toBeTruthy()
      expect(table.textContent).toContain('cobrança em atraso')
      expect(table.textContent).toContain('reason')
      expect(table.textContent).toContain('tenant · lume')
      await user.click(button)
      expect(within(screen.getByRole('table')).queryByText('cobrança em atraso')).toBeNull()
    })

    it('filtros por tipo reconsultam o servidor com a categoria certa', async () => {
      const server = mount([
        ev(1, { action: 'tenant.create' }),
        ev(2, { action: 'owner.assign' }),
        ev(3, { action: 'support.request.create' }),
        ev(4, { action: 'email.delivery.sent' }),
      ])
      const user = userEvent.setup()
      await open('/admin/clinicas/lume/auditoria')
      await screen.findByRole('table')
      expect(rows()).toHaveLength(4)
      const group = screen.getByRole('group', { name: 'Tipo de evento' })
      await user.click(within(group).getByRole('button', { name: 'Suporte' }))
      await waitFor(() => expect(rows()).toHaveLength(1))
      expect(rows()[0]!.textContent).toContain('Pediu sessão de suporte')
      expect(server.requests.at(-1)).toContain('category=support')
      await user.click(within(group).getByRole('button', { name: 'Owners e membros' }))
      await waitFor(() => expect(rows()[0]!.textContent).toContain('Atribuiu owner'))
      expect(server.requests.at(-1)).toContain('category=members')
      await user.click(within(group).getByRole('button', { name: 'Tudo' }))
      await waitFor(() => expect(rows()).toHaveLength(4))
      expect(server.requests.at(-1)).not.toContain('category')
    })

    it('o período muda a consulta (30 dias por omissão)', async () => {
      const server = mount([ev(1)])
      const user = userEvent.setup()
      await open('/admin/clinicas/lume/auditoria')
      await screen.findByRole('table')
      expect(server.requests[0]).toContain('days=30')
      await user.selectOptions(screen.getByRole('combobox', { name: 'Período' }), '7')
      await waitFor(() => expect(server.requests.at(-1)).toContain('days=7'))
      await user.selectOptions(screen.getByRole('combobox', { name: 'Período' }), '90')
      await waitFor(() => expect(server.requests.at(-1)).toContain('days=90'))
    })

    it('«Carregar mais» acrescenta a página seguinte sem repetir e some no fim', async () => {
      const server = mount(Array.from({ length: 7 }, (_, i) => ev(i + 1, { id: `aud_${i}` })))
      const user = userEvent.setup()
      await open('/admin/clinicas/lume/auditoria')
      await screen.findByRole('table')
      // Página de 50: tudo cabe e não há botão.
      expect(rows()).toHaveLength(7)
      expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull()
      cleanup()
      const big = mount(Array.from({ length: 60 }, (_, i) => ev(i + 1, { id: `aud_${String(i).padStart(3, '0')}` })))
      await open('/admin/clinicas/lume/auditoria')
      await screen.findByRole('table')
      expect(rows()).toHaveLength(50)
      await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
      await waitFor(() => expect(rows()).toHaveLength(60))
      expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull()
      expect(big.requests.at(-1)).toContain('cursor=50')
      expect(server.requests.length).toBeGreaterThan(0)
    })

    it('falha ao carregar mais mostra a frase e mantém o que já está no ecrã', async () => {
      const server = mount(Array.from({ length: 60 }, (_, i) => ev(i + 1, { id: `aud_${String(i).padStart(3, '0')}` })))
      server.failMore = true
      const user = userEvent.setup()
      await open('/admin/clinicas/lume/auditoria')
      await screen.findByRole('table')
      await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
      expect(await screen.findByText('Não foi possível concluir. Tente de novo.')).toBeTruthy()
      expect(rows()).toHaveLength(50)
      await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
      await waitFor(() => expect(rows()).toHaveLength(60))
    })

    it('vazio e erro com «Tentar de novo»', async () => {
      mount([])
      await open('/admin/clinicas/lume/auditoria')
      expect(await screen.findByText('Sem eventos neste período')).toBeTruthy()
      cleanup()
      const server = mount([ev(1)])
      server.failOnce = true
      const user = userEvent.setup()
      await open('/admin/clinicas/lume/auditoria')
      expect(await screen.findByText('Não foi possível carregar a auditoria')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
      expect(await screen.findByRole('table')).toBeTruthy()
    })

    it('só leitura: sem ações de edição e com a nota de que não há conteúdo de conversas', async () => {
      mount([ev(1)])
      await open('/admin/clinicas/lume/auditoria')
      await screen.findByRole('table')
      expect(screen.getByText(/não guarda conteúdo de conversas/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Exportar|Apagar|Editar/ })).toBeNull()
    })
  })

  describe('PA-01 atividade recente', () => {
    it('mostra os últimos eventos da plataforma com a clínica', async () => {
      const server = mount([
        ev(1, { action: 'tenant.create', tenantName: 'Clínica Jardim Sul' }),
        ev(2, { action: 'support.request.create', tenantName: 'Espaço Lume' }),
        ev(3, { action: 'platform.sem.clinica', tenantId: null, tenantName: null }),
      ])
      await open('/admin')
      const heading = await screen.findByRole('heading', { name: 'Atividade recente da plataforma' })
      const section = heading.closest('section')!
      expect(await within(section).findByText('Criou a clínica')).toBeTruthy()
      expect(section.textContent).toContain('Clínica Jardim Sul')
      expect(section.textContent).toContain('Pediu sessão de suporte')
      expect(within(section).getAllByText('—').length).toBeGreaterThan(0)
      expect(server.requests.some((u) => u === '/api/platform/audit?limit=5')).toBe(true)
    })
  })
})
