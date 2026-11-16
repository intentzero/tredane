import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../ui/panel.css'
import { writeSynthUserId } from '../panel/auth/session'
import type { AuditEvent, ClinicHealth, HealthOverview } from './api'
import { AdminApp } from './AdminApp'

const NOW = Date.now()
const MIN = 60_000

const counts = (over: Partial<NonNullable<ClinicHealth['counts']>> = {}): NonNullable<ClinicHealth['counts']> => ({
  pendingOutbox: 0,
  failedOutbox: 0,
  uncertainOutbound: 0,
  llmJobsOpen: 0,
  llmJobsFailed1h: 0,
  schemaVersion: 41,
  schemaReady: true,
  ...over,
})

const clinic = (over: Partial<ClinicHealth> & Pick<ClinicHealth, 'tenantId' | 'name'>): ClinicHealth => ({
  tenantStatus: 'active',
  whatsapp: { status: 'connected' },
  situation: 'normal',
  stale: false,
  alerts: [],
  readAt: NOW - 3 * MIN,
  lastOkAt: NOW - 3 * MIN,
  counts: counts(),
  ...over,
})

function seed(): ClinicHealth[] {
  return [
    clinic({
      tenantId: 'lume',
      name: 'Espaço Lume',
      situation: 'critical',
      whatsapp: { status: 'error' },
      counts: counts({ failedOutbox: 7, pendingOutbox: 3 }),
    }),
    clinic({
      tenantId: 'vila',
      name: 'Studio Vila Nova',
      situation: 'attention',
      alerts: [{ kind: 'outbound.uncertain', severity: 'warning', reason: 'x', value: 5, threshold: 5 }],
      counts: counts({ uncertainOutbound: 5, llmJobsOpen: 1 }),
    }),
    clinic({ tenantId: 'aurora', name: 'Clínica Aurora', counts: counts({ llmJobsOpen: 2, llmJobsFailed1h: 4 }), situation: 'attention' }),
    clinic({ tenantId: 'jardim', name: 'Clínica Jardim Sul', situation: 'no_data', counts: null, readAt: null, lastOkAt: null }),
    clinic({ tenantId: 'bem', name: 'Bem Estar Centro', tenantStatus: 'suspended', situation: 'inactive', readAt: NOW - 120 * MIN }),
    clinic({ tenantId: 'pele', name: 'Pele Nova', situation: 'no_data', stale: true, counts: null, lastOkAt: null, readAt: NOW - 13 * MIN }),
  ]
}

type Server = {
  clinics: ClinicHealth[]
  summaryAt: number | null
  requests: Array<{ method: string; url: string }>
  overviewFails: number
  audit: AuditEvent[]
  refreshResult: ClinicHealth | { status: number; error: string } | null
}

function mount(clinics: ClinicHealth[], summaryAt: number | null = NOW - 3 * MIN): Server {
  const server: Server = { clinics, summaryAt, requests: [], overviewFails: 0, audit: [], refreshResult: null }
  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.includes('/api/auth/client-config')) return j({ authMode: 'synthetic', clerkPublishableKey: null })
      if (url.endsWith('/api/me')) return j({ kind: 'human', clerkUserId: 'u', sessionId: 's', isSuperadmin: true })
      server.requests.push({ method, url })
      if (url === '/api/platform/health') {
        if (server.overviewFails > 0) {
          server.overviewFails -= 1
          return j({ error: 'boom' }, 503)
        }
        const active = server.clinics.filter((c) => c.tenantStatus === 'active')
        const count = (s: string) => active.filter((c) => c.situation === s).length
        const overview: HealthOverview = {
          summaryAt: server.summaryAt,
          refreshIntervalMs: 600_000,
          totals: {
            activeClinics: active.length,
            critical: count('critical'),
            attention: count('attention'),
            normal: count('normal'),
            noData: count('no_data'),
            unreachable: active.filter((c) => c.stale).length,
            llmJobsOpen: active.reduce((n, c) => n + (c.counts?.llmJobsOpen ?? 0), 0),
          },
          clinics: server.clinics,
        }
        return j(overview)
      }
      if (url.startsWith('/api/platform/audit')) return j({ events: server.audit, nextCursor: null, clinicalAccess: false })
      if (url === '/api/platform/support') return j({ items: [], clinicalAccess: false })
      if (url === '/api/platform/tenants') {
        return j({
          tenants: server.clinics.map((c, i) => ({
            id: c.tenantId,
            name: c.name,
            timezone: 'America/Sao_Paulo',
            status: c.tenantStatus,
            createdAt: 1,
            updatedAt: 1,
            suspendedAt: null,
            pendingDeletionAt: null,
            ownerCount: c.tenantId === 'jardim' ? 0 : 1,
            memberCount: i,
            whatsapp: c.whatsapp,
          })),
        })
      }
      const hm = /^\/api\/platform\/tenants\/([^/]+)\/health(\/refresh)?$/.exec(url)
      if (hm) {
        const id = decodeURIComponent(hm[1]!)
        const c = server.clinics.find((x) => x.tenantId === id)
        if (!c) return j({ error: 'tenant_not_found' }, 404)
        if (hm[2]) {
          const r = server.refreshResult
          if (r && 'status' in r) return j({ error: r.error }, r.status)
          if (r) Object.assign(c, r)
        }
        return j({ health: c, refreshIntervalMs: 600_000 })
      }
      const dm = /^\/api\/platform\/tenants\/([^/]+)$/.exec(url)
      if (dm) {
        const c = server.clinics.find((x) => x.tenantId === decodeURIComponent(dm[1]!))
        if (!c) return j({ error: 'tenant_not_found' }, 404)
        return j({
          tenant: { id: c.tenantId, name: c.name, timezone: 'America/Sao_Paulo', status: c.tenantStatus, createdAt: 1, updatedAt: 1, suspendedAt: null, pendingDeletionAt: null },
          members: [],
          owners: [],
          integration: {
            whatsapp: { status: c.whatsapp.status, note: `nota ${c.whatsapp.status}` },
            pix: { status: 'not_configured', note: 'x' },
          },
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

describe('Platform Admin — saúde (#833, DEC-193)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    writeSynthUserId('user_synth_superadmin')
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  describe('PA-06 saúde global', () => {
    it('tabela com situação, WhatsApp e contagens; «—» onde não há dados', async () => {
      mount(seed())
      const { container } = await open('/admin/saude')
      const table = await screen.findByRole('table')
      const lume = rowOf(table, 'Espaço Lume')
      expect(within(lume).getByText('Crítico')).toBeTruthy()
      expect(within(lume).getByText('Erro')).toBeTruthy()
      expect(within(lume).getByText('v41')).toBeTruthy()
      expect(within(rowOf(table, 'Studio Vila Nova')).getByText('Atenção')).toBeTruthy()
      const jardim = rowOf(table, 'Clínica Jardim Sul')
      expect(within(jardim).getByText('Sem dados')).toBeTruthy()
      expect(within(jardim).getByText('nunca lida')).toBeTruthy()
      expect(within(jardim).getAllByText('—').length).toBeGreaterThanOrEqual(5)
      expect(within(rowOf(table, 'Pele Nova')).getByText('sem resposta')).toBeTruthy()
      const bem = rowOf(table, 'Bem Estar Centro')
      expect(within(bem).getByText('Inativa')).toBeTruthy()
      expect(within(bem).getByText('suspensa')).toBeTruthy()
      await checkA11y(container)
    })

    it('cartões somam crítico, atenção, jobs de IA e sem resposta só das clínicas ativas', async () => {
      mount(seed())
      await open('/admin/saude')
      await screen.findByRole('table')
      const stat = (label: string) => screen.getByText(label, { selector: '.admin-stat span' }).previousElementSibling!.textContent
      expect(stat('Crítico')).toBe('1')
      expect(stat('Atenção')).toBe('2')
      expect(stat('Jobs de IA na fila (todas)')).toBe('3')
      expect(stat('Clínicas sem resposta')).toBe('1')
    })

    it('o nome da clínica leva à aba Saúde dela', async () => {
      mount(seed())
      const user = userEvent.setup()
      await open('/admin/saude')
      const link = await screen.findByRole('link', { name: 'Espaço Lume' })
      expect(link.getAttribute('href')).toBe('/admin/clinicas/lume/saude')
      await user.click(link)
      expect(window.location.pathname).toBe('/admin/clinicas/lume/saude')
    })

    it('resumo parado há mais de 20 minutos avisa; resumo recente não; sem resumo diz que ainda não correu', async () => {
      mount(seed(), NOW - 45 * MIN)
      await open('/admin/saude')
      expect(await screen.findByText(/mais de 20 minutos/)).toBeTruthy()
      cleanup()
      mount(seed(), NOW - 2 * MIN)
      await open('/admin/saude')
      await screen.findByRole('table')
      expect(screen.queryByText(/mais de 20 minutos/)).toBeNull()
      cleanup()
      mount(seed().map((c) => ({ ...c, readAt: null, lastOkAt: null, counts: null, situation: 'no_data' as const })), null)
      await open('/admin/saude')
      expect(await screen.findByText(/ainda não correu/)).toBeTruthy()
    })

    it('sem clínicas mostra a frase vazia; erro permite tentar de novo', async () => {
      const server = mount([])
      await open('/admin/saude')
      expect(await screen.findByText('Ainda não há clínicas')).toBeTruthy()
      cleanup()
      const s2 = mount(seed())
      s2.overviewFails = 1
      const user = userEvent.setup()
      await open('/admin/saude')
      expect(await screen.findByText('Não foi possível carregar a saúde')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
      expect(await screen.findByRole('table')).toBeTruthy()
      expect(server.requests.length).toBeGreaterThan(0)
    })

    it('«Recarregar» relê o resumo (só o D1, nunca uma leitura ao DO)', async () => {
      const server = mount(seed())
      const user = userEvent.setup()
      await open('/admin/saude')
      await screen.findByRole('table')
      const before = server.requests.filter((r) => r.url === '/api/platform/health').length
      await user.click(screen.getByRole('button', { name: 'Recarregar' }))
      await waitFor(() => expect(server.requests.filter((r) => r.url === '/api/platform/health').length).toBeGreaterThan(before))
      expect(server.requests.some((r) => r.url.endsWith('/health/refresh'))).toBe(false)
    })
  })

  describe('PA-01 visão geral', () => {
    it('contadores por estado, clínicas que precisam de atenção com os sinais, e links', async () => {
      mount(seed())
      const user = userEvent.setup()
      const { container } = await open('/admin')
      const table = await screen.findByRole('table')
      const stat = (label: string) => screen.getByText(label, { selector: '.admin-stat span' }).previousElementSibling!.textContent
      expect(stat('Clínicas ativas')).toBe('4')
      expect(stat('Em configuração')).toBe('1')
      expect(stat('Suspensas')).toBe('1')
      const rows = within(table).getAllByRole('row').slice(1)
      expect(rows.map((r) => r.textContent)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('WhatsApp interrompido pela Meta'),
          expect.stringContaining('Envios com estado incerto (5)'),
          expect.stringContaining('4 job(s) de IA falhado(s) na última hora'),
        ]),
      )
      expect(rows).toHaveLength(3)
      expect(within(table).queryByText('Bem Estar Centro')).toBeNull()
      expect(within(table).queryByText('Pele Nova')).toBeNull()
      expect(screen.getByText('Nenhum pedido em aberto.')).toBeTruthy()
      expect(screen.getByText('Ainda não há atividade registada.')).toBeTruthy()
      await checkA11y(container)
      await user.click(screen.getByRole('link', { name: 'Ver a saúde de todas as clínicas' }))
      expect(window.location.pathname).toBe('/admin/saude')
    })

    it('sem sinais de problema diz isso em vez de uma tabela vazia', async () => {
      mount([clinic({ tenantId: 'a', name: 'Só Normal' })])
      await open('/admin')
      expect(await screen.findByText(/Nenhuma clínica ativa com sinais de problema/)).toBeTruthy()
      expect(screen.queryByRole('table')).toBeNull()
    })
  })

  describe('PA-09 aba Saúde da clínica', () => {
    it('alertas com valor e limiar, cartões Envios, WhatsApp, IA e Dados; sem telefone nem volume', async () => {
      mount(seed())
      const { container } = await open('/admin/clinicas/vila/saude')
      const alerts = await screen.findByRole('table')
      expect(within(alerts).getByText('Envios com estado incerto')).toBeTruthy()
      expect(within(alerts).getByText('≥ 5')).toBeTruthy()
      expect(screen.getByRole('region', { name: 'Envios' })).toBeTruthy()
      expect(screen.getByRole('region', { name: 'IA' }).textContent).toContain('1')
      expect(screen.getByText(/nota connected/)).toBeTruthy()
      expect(screen.getByText(/Sem número de telefone nesta tela/)).toBeTruthy()
      expect(screen.queryByText('Contatos')).toBeNull()
      expect(screen.queryByText('Mensagens')).toBeNull()
      await checkA11y(container)
    })

    it('«Atualizar» pede a leitura desta clínica e mostra o resultado', async () => {
      const server = mount(seed())
      server.refreshResult = clinic({ tenantId: 'aurora', name: 'Clínica Aurora', situation: 'normal', counts: counts({ llmJobsOpen: 9 }) })
      const user = userEvent.setup()
      await open('/admin/clinicas/aurora/saude')
      await screen.findByRole('region', { name: 'IA' })
      expect(within(screen.getByRole('region', { name: 'IA' })).getByText('4')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Atualizar' }))
      await waitFor(() => expect(within(screen.getByRole('region', { name: 'IA' })).getByText('9')).toBeTruthy())
      expect(server.requests.filter((r) => r.method === 'POST').map((r) => r.url)).toEqual([
        '/api/platform/tenants/aurora/health/refresh',
      ])
    })

    it('«Atualizar» com erro mostra a frase e mantém os números', async () => {
      const server = mount(seed())
      server.refreshResult = { status: 403, error: 'tenant_not_active' }
      const user = userEvent.setup()
      await open('/admin/clinicas/aurora/saude')
      await screen.findByRole('region', { name: 'IA' })
      await user.click(screen.getByRole('button', { name: 'Atualizar' }))
      expect(await screen.findByText('A clínica não está ativa: não há leituras novas.')).toBeTruthy()
      expect(within(screen.getByRole('region', { name: 'IA' })).getByText('4')).toBeTruthy()
    })

    it('clínica suspensa: sem «Atualizar», avisa que os números são da última leitura', async () => {
      mount(seed())
      await open('/admin/clinicas/bem/saude')
      expect(await screen.findByText(/não há leituras novas/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Atualizar' })).toBeNull()
      expect(screen.getByRole('region', { name: 'Envios' })).toBeTruthy()
    })

    it('Durable Object sem resposta: com leitura boa avisa e mantém os números; sem nenhuma, diz que não há leitura', async () => {
      mount([
        clinic({ tenantId: 'a', name: 'Com Histórico', stale: true, counts: counts({ pendingOutbox: 4 }) }),
        clinic({ tenantId: 'b', name: 'Sem Histórico', stale: true, situation: 'no_data', counts: null, lastOkAt: null }),
      ])
      await open('/admin/clinicas/a/saude')
      expect(await screen.findByText(/última leitura boa/)).toBeTruthy()
      expect(screen.getByRole('region', { name: 'Envios' })).toBeTruthy()
      cleanup()
      mount([clinic({ tenantId: 'b', name: 'Sem Histórico', stale: true, situation: 'no_data', counts: null, lastOkAt: null })])
      await open('/admin/clinicas/b/saude')
      expect(await screen.findByText(/ainda não há nenhuma leitura boa/)).toBeTruthy()
      expect(screen.getByText(/Sem números ainda/)).toBeTruthy()
      expect(screen.queryByRole('region', { name: 'Envios' })).toBeNull()
    })
  })
})
