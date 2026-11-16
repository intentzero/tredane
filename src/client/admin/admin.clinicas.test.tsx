import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../ui/panel.css'
import { writeSynthUserId } from '../panel/auth/session'
import { AdminApp } from './AdminApp'

type Row = {
  id: string
  name: string
  timezone: string
  status: 'active' | 'suspended' | 'pending_deletion'
  createdAt: number
  updatedAt: number
  suspendedAt: number | null
  pendingDeletionAt: number | null
  ownerCount: number
  memberCount: number
  whatsapp: { status: string }
}

const T0 = Date.UTC(2026, 9, 20, 15)
const row = (over: Partial<Row> & Pick<Row, 'id' | 'name'>): Row => ({
  timezone: 'America/Sao_Paulo',
  status: 'active',
  createdAt: T0,
  updatedAt: T0,
  suspendedAt: null,
  pendingDeletionAt: null,
  ownerCount: 1,
  memberCount: 2,
  whatsapp: { status: 'connected' },
  ...over,
})

function seed(): Row[] {
  return [
    row({ id: 'aurora', name: 'Clínica Aurora', memberCount: 4, ownerCount: 2 }),
    row({ id: 'lume', name: 'Espaço Lume', whatsapp: { status: 'error' } }),
    row({ id: 'jardim', name: 'Clínica Jardim Sul', ownerCount: 0, memberCount: 0, whatsapp: { status: 'not_connected' } }),
    row({ id: 'bem', name: 'Bem Estar Centro', status: 'suspended', suspendedAt: T0, whatsapp: { status: 'pending' } }),
    row({ id: 'pele', name: 'Pele Nova', status: 'pending_deletion', pendingDeletionAt: T0 }),
  ]
}

/** Tira os campos que só existem na lista, sem variáveis por usar (lint). */
function asTenant(r: Row) {
  const tenant: Record<string, unknown> = { ...r }
  delete tenant.ownerCount
  delete tenant.memberCount
  delete tenant.whatsapp
  return tenant
}

type Server = {
  rows: Row[]
  requests: Array<{ method: string; url: string; body: unknown }>
  /** Resposta forçada para o próximo pedido que não seja GET. */
  failNext: { status: number; error: string } | null
  listFails: number
  me: { isSuperadmin: boolean }
}

function mountServer(rows: Row[]): Server {
  const server: Server = { rows, requests: [], failNext: null, listFails: 0, me: { isSuperadmin: true } }
  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (url.includes('/api/auth/client-config')) return j({ authMode: 'synthetic', clerkPublishableKey: null })
      if (url.endsWith('/api/me')) {
        return j({ kind: 'human', clerkUserId: 'u', sessionId: 's', isSuperadmin: server.me.isSuperadmin })
      }
      server.requests.push({ method, url, body })
      if (url === '/api/platform/tenants') {
        if (server.listFails > 0) {
          server.listFails -= 1
          return j({ error: 'boom' }, 503)
        }
        return j({ tenants: server.rows })
      }
      const m = /^\/api\/platform\/tenants\/([^/]+)(?:\/(suspend|reactivate))?$/.exec(url)
      if (!m) return j({ error: 'not_found' }, 404)
      const id = decodeURIComponent(m[1]!)
      const r = server.rows.find((x) => x.id === id)
      if (!r) return j({ error: 'tenant_not_found' }, 404)
      if (method === 'GET') {
        const members = Array.from({ length: r.memberCount }, (_, i) => ({
          tenantId: id,
          clerkUserId: i < r.ownerCount ? `user_owner_${i}` : `user_att_${i}`,
          role: i < r.ownerCount ? 'owner' : 'attendant',
          status: 'active',
          createdAt: T0,
          revokedAt: null,
        }))
        return j({
          tenant: asTenant(r),
          members,
          owners: members.filter((x) => x.role === 'owner'),
          integration: {
            whatsapp: { status: r.whatsapp.status, note: `nota ${r.whatsapp.status}` },
            pix: { status: 'not_configured', note: 'Adaptador Pix simulado' },
          },
          deletionCommand: null,
          clinicalAccess: false,
        })
      }
      if (server.failNext) {
        const f = server.failNext
        server.failNext = null
        return j({ error: f.error }, f.status)
      }
      if (m[2] === 'suspend') Object.assign(r, { status: 'suspended', suspendedAt: T0 })
      else if (m[2] === 'reactivate') Object.assign(r, { status: 'active', suspendedAt: null })
      else if (method === 'DELETE') Object.assign(r, { status: 'pending_deletion', pendingDeletionAt: T0 })
      else if (method === 'PATCH') Object.assign(r, body)
      return j({ tenant: asTenant(r) })
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

describe('Platform Admin — clínicas (#829)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    writeSynthUserId('user_synth_superadmin')
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  describe('lista (PA-02)', () => {
    it('mostra estado, WhatsApp, owners, membros e criação; «Em configuração» é ativa sem owner', async () => {
      mountServer(seed())
      const { container } = await open('/admin/clinicas')
      const table = await screen.findByRole('table')
      const rows = within(table).getAllByRole('row').slice(1)
      expect(rows).toHaveLength(5)
      const aurora = rows.find((r) => r.textContent?.includes('Clínica Aurora'))!
      expect(within(aurora).getByText('Ativa')).toBeTruthy()
      expect(within(aurora).getByText('Ligado')).toBeTruthy()
      expect(aurora.textContent).toContain('20/10/2026')
      const jardim = rows.find((r) => r.textContent?.includes('Jardim Sul'))!
      expect(within(jardim).getByText('Em configuração')).toBeTruthy()
      expect(within(jardim).getByText('Não ligado')).toBeTruthy()
      expect(within(rows.find((r) => r.textContent?.includes('Bem Estar'))!).getByText('Suspensa')).toBeTruthy()
      expect(within(rows.find((r) => r.textContent?.includes('Pele Nova'))!).getByText('Exclusão pendente')).toBeTruthy()
      expect(within(rows.find((r) => r.textContent?.includes('Lume'))!).getByText('Erro')).toBeTruthy()
      await checkA11y(container)
    })

    it('os contadores dos filtros somam por estado e o filtro esconde as outras linhas', async () => {
      mountServer(seed())
      const user = userEvent.setup()
      await open('/admin/clinicas')
      const group = await screen.findByRole('group', { name: 'Estado' })
      expect(within(group).getByRole('button', { name: 'Todas 5' })).toBeTruthy()
      expect(within(group).getByRole('button', { name: 'Ativas 2' })).toBeTruthy()
      expect(within(group).getByRole('button', { name: 'Em configuração 1' })).toBeTruthy()
      await user.click(within(group).getByRole('button', { name: 'Suspensas 1' }))
      const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.textContent).toContain('Bem Estar Centro')
    })

    it('a busca ignora acentos e maiúsculas e avisa quando nada corresponde', async () => {
      mountServer(seed())
      const user = userEvent.setup()
      await open('/admin/clinicas')
      const search = await screen.findByRole('searchbox', { name: 'Buscar por nome' })
      await user.type(search, 'CLINICA')
      expect(within(screen.getByRole('table')).getAllByRole('row').slice(1)).toHaveLength(2)
      await user.clear(search)
      await user.type(search, 'zzz')
      expect(await screen.findByText('Nenhuma clínica encontrada')).toBeTruthy()
      expect(screen.queryByRole('table')).toBeNull()
    })

    it('o nome é um link para o detalhe e navega sem recarregar', async () => {
      mountServer(seed())
      const user = userEvent.setup()
      await open('/admin/clinicas')
      const link = await screen.findByRole('link', { name: 'Espaço Lume' })
      expect(link.getAttribute('href')).toBe('/admin/clinicas/lume')
      await user.click(link)
      expect(window.location.pathname).toBe('/admin/clinicas/lume')
      expect(await screen.findByRole('heading', { level: 1, name: 'Espaço Lume' })).toBeTruthy()
    })

    it('erro mostra «Tentar de novo» e recupera; lista vazia tem a sua frase', async () => {
      const server = mountServer(seed())
      server.listFails = 1
      const user = userEvent.setup()
      await open('/admin/clinicas')
      expect(await screen.findByText('Não foi possível carregar as clínicas')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
      expect(await screen.findByRole('table')).toBeTruthy()
      cleanup()
      mountServer([])
      await open('/admin/clinicas')
      expect(await screen.findByText('Ainda não há clínicas')).toBeTruthy()
    })
  })

  describe('detalhe (PA-04)', () => {
    it('Resumo: dados, integrações e owners; abas na URL; contador de membros', async () => {
      mountServer(seed())
      const user = userEvent.setup()
      const { container } = await open('/admin/clinicas/aurora')
      expect(await screen.findByRole('heading', { level: 1, name: 'Clínica Aurora' })).toBeTruthy()
      expect(screen.getByText(/id aurora/)).toBeTruthy()
      expect(screen.getByText('nota connected')).toBeTruthy()
      expect(screen.getByText('Pix (Woovi)')).toBeTruthy()
      expect(screen.getByText('user_owner_0')).toBeTruthy()
      expect(screen.getByText('user_owner_1')).toBeTruthy()
      const tabs = screen.getByRole('navigation', { name: 'Seções da clínica' })
      expect(within(tabs).getByRole('link', { name: 'Resumo' }).getAttribute('aria-current')).toBe('page')
      expect(within(tabs).getByRole('link', { name: 'Membros 4' })).toBeTruthy()
      await checkA11y(container)
      await user.click(within(tabs).getByRole('link', { name: 'Auditoria' }))
      expect(window.location.pathname).toBe('/admin/clinicas/aurora/auditoria')
      expect(await screen.findByText(/issue #832/)).toBeTruthy()
      expect(screen.getByRole('link', { name: 'Auditoria' }).getAttribute('aria-current')).toBe('page')
    })

    it('clínica inexistente mostra «Clínica não encontrada»', async () => {
      mountServer(seed())
      await open('/admin/clinicas/nao-existe')
      expect(await screen.findByText('Clínica não encontrada')).toBeTruthy()
    })

    it('sem owner ativa diz isso e o estado é «Em configuração»', async () => {
      mountServer(seed())
      await open('/admin/clinicas/jardim')
      expect(await screen.findByText('Esta clínica ainda não tem owner ativa.')).toBeTruthy()
      expect(screen.getAllByText('Em configuração').length).toBeGreaterThan(0)
    })

    it('suspender: o motivo é obrigatório e o estado só muda depois da resposta do servidor', async () => {
      const server = mountServer(seed())
      const user = userEvent.setup()
      await open('/admin/clinicas/aurora')
      await user.click(await screen.findByRole('button', { name: 'Suspender' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: 'Suspender clínica' }))
      expect(await within(dialog).findByText(/Escreva o motivo/)).toBeTruthy()
      expect(server.requests.some((r) => r.url.endsWith('/suspend'))).toBe(false)

      await user.type(within(dialog).getByLabelText(/Motivo/), '  pedido da clínica  ')
      await user.click(within(dialog).getByRole('button', { name: 'Suspender clínica' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(server.requests.find((r) => r.url.endsWith('/suspend'))).toMatchObject({
        method: 'POST',
        body: { reason: 'pedido da clínica' },
      })
      expect(await screen.findByRole('button', { name: 'Reativar' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Suspender' })).toBeNull()
      expect(screen.getAllByText('Suspensa').length).toBeGreaterThan(0)
    })

    it('falha do servidor mantém o diálogo aberto com a frase e o estado antigo', async () => {
      const server = mountServer(seed())
      server.failNext = { status: 409, error: 'tenant_status_conflict' }
      const user = userEvent.setup()
      await open('/admin/clinicas/aurora')
      await user.click(await screen.findByRole('button', { name: 'Suspender' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.type(within(dialog).getByLabelText(/Motivo/), 'cobrança em atraso')
      await user.click(within(dialog).getByRole('button', { name: 'Suspender clínica' }))
      expect(await within(dialog).findByRole('alert')).toBeTruthy()
      expect(dialog.textContent).toContain('O estado da clínica mudou entretanto')
      expect(dialog.textContent).not.toContain('tenant_status_conflict')
      expect(screen.getAllByText('Ativa').length).toBeGreaterThan(0)
      expect(screen.queryByText('Suspensa')).toBeNull()
    })

    it('reativar uma clínica suspensa pede motivo e volta a «Ativa»', async () => {
      const server = mountServer(seed())
      const user = userEvent.setup()
      await open('/admin/clinicas/bem')
      await user.click(await screen.findByRole('button', { name: 'Reativar' }))
      const dialog = await screen.findByRole('alertdialog')
      expect(dialog.textContent).toContain('continuam revogados')
      await user.type(within(dialog).getByLabelText(/Motivo/), 'regularizou')
      await user.click(within(dialog).getByRole('button', { name: 'Reativar clínica' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(server.requests.find((r) => r.url.endsWith('/reactivate'))?.body).toEqual({ reason: 'regularizou' })
      expect(await screen.findByRole('button', { name: 'Suspender' })).toBeTruthy()
    })

    it('excluir exige o nome da clínica; depois mostra «Exclusão pendente» sem ações', async () => {
      const server = mountServer(seed())
      const user = userEvent.setup()
      await open('/admin/clinicas/lume')
      await user.click(await screen.findByRole('button', { name: 'Excluir' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.type(within(dialog).getByLabelText(/Motivo/), 'encerramento do contrato')
      await user.type(within(dialog).getByLabelText(/escreva o nome/i), 'Outro nome')
      await user.click(within(dialog).getByRole('button', { name: 'Excluir clínica' }))
      expect(await within(dialog).findByText('O nome não corresponde ao da clínica.')).toBeTruthy()
      expect(server.requests.some((r) => r.method === 'DELETE')).toBe(false)

      await user.clear(within(dialog).getByLabelText(/escreva o nome/i))
      await user.type(within(dialog).getByLabelText(/escreva o nome/i), 'Espaço Lume')
      await user.click(within(dialog).getByRole('button', { name: 'Excluir clínica' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(server.requests.find((r) => r.method === 'DELETE')?.body).toEqual({ reason: 'encerramento do contrato' })
      expect((await screen.findAllByText('Exclusão pendente')).length).toBeGreaterThan(0)
      expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Suspender' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    })

    it('clínica já em exclusão pendente não oferece ações', async () => {
      mountServer(seed())
      await open('/admin/clinicas/pele')
      expect(await screen.findByRole('heading', { level: 1, name: 'Pele Nova' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
      expect(screen.getByText(/aguarda a retenção/)).toBeTruthy()
    })

    it('Editar envia nome e fuso e mostra o novo nome', async () => {
      const server = mountServer(seed())
      const user = userEvent.setup()
      await open('/admin/clinicas/aurora')
      await user.click(await screen.findByRole('button', { name: 'Editar' }))
      const dialog = await screen.findByRole('dialog')
      const name = within(dialog).getByLabelText('Nome da clínica')
      await user.clear(name)
      await user.type(name, 'Clínica Aurora Centro')
      await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(server.requests.find((r) => r.method === 'PATCH')?.body).toEqual({
        name: 'Clínica Aurora Centro',
        timezone: 'America/Sao_Paulo',
      })
      expect(await screen.findByRole('heading', { level: 1, name: 'Clínica Aurora Centro' })).toBeTruthy()
    })

    it('Editar não aceita nome vazio', async () => {
      const server = mountServer(seed())
      const user = userEvent.setup()
      await open('/admin/clinicas/aurora')
      await user.click(await screen.findByRole('button', { name: 'Editar' }))
      const dialog = await screen.findByRole('dialog')
      await user.clear(within(dialog).getByLabelText('Nome da clínica'))
      await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))
      expect(await within(dialog).findByText('Escreva o nome da clínica.')).toBeTruthy()
      expect(server.requests.some((r) => r.method === 'PATCH')).toBe(false)
    })
  })
})
