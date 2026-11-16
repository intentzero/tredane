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

type Inv = {
  id: string
  email: string
  role: 'owner'
  status: 'pending' | 'cancelled'
  issuedAt: number
  expiresAt: number
  lastResentAt: number | null
  expired: boolean
}
const inv = (over: Partial<Inv> = {}): Inv => ({
  id: 'inv_1',
  email: 'dona@example.test',
  role: 'owner',
  status: 'pending',
  issuedAt: T0,
  expiresAt: T0 + 7 * 86_400_000,
  lastResentAt: null,
  expired: false,
  ...over,
})

type Mem = {
  tenantId: string
  clerkUserId: string
  role: 'owner' | 'attendant'
  status: 'active' | 'revoked'
  createdAt: number
  revokedAt: number | null
  displayName: string | null
  email: string | null
}

type Server = {
  members: Record<string, Mem[]>
  invitations: Record<string, Inv[]>
  /** `emailSent` devolvido por criar/reenviar/emitir. */
  emailSent: boolean
  rows: Row[]
  requests: Array<{ method: string; url: string; body: unknown }>
  /** Resposta forçada para o próximo pedido que não seja GET. */
  failNext: { status: number; error: string } | null
  listFails: number
  me: { isSuperadmin: boolean }
}

function mountServer(rows: Row[]): Server {
  const server: Server = {
    members: {},
    invitations: {},
    emailSent: true,
    rows,
    requests: [],
    failNext: null,
    listFails: 0,
    me: { isSuperadmin: true },
  }
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
      if (url === '/api/platform/tenants' && method === 'POST') {
        if (server.failNext) {
          const f = server.failNext
          server.failNext = null
          return j({ error: f.error }, f.status)
        }
        const created = row({ id: 'nova-id', name: String((body as { name: string }).name), ownerCount: 0, memberCount: 0 })
        server.rows.push(created)
        const invite = inv({ id: 'inv_new', email: String((body as { ownerEmail: string }).ownerEmail) })
        server.invitations[created.id] = [invite]
        return j({ tenant: asTenant(created), invitation: invite, emailSent: server.emailSent }, 201)
      }
      const membersOf = (tid: string): Mem[] => {
        const r = server.rows.find((x) => x.id === tid)
        if (!r) return []
        return (server.members[tid] ??= Array.from({ length: r.memberCount }, (_, i) => ({
          tenantId: tid,
          clerkUserId: i < r.ownerCount ? `user_owner_${i}` : `user_att_${i}`,
          role: i < r.ownerCount ? ('owner' as const) : ('attendant' as const),
          status: 'active' as const,
          createdAt: T0,
          revokedAt: null,
          displayName: i < r.ownerCount ? `Owner ${i}` : `Attendant ${i}`,
          email: i < r.ownerCount ? `owner${i}@example.test` : `att${i}@example.test`,
        })))
      }
      if (/^\/api\/platform\/tenants\/[^/]+\/audit/.test(url)) return j({ events: [], nextCursor: null, clinicalAccess: false })
      const mm = /^\/api\/platform\/tenants\/([^/]+)\/members$/.exec(url)
      if (mm) {
        const tid = decodeURIComponent(mm[1]!)
        if (!server.rows.some((x) => x.id === tid)) return j({ error: 'tenant_not_found' }, 404)
        return j({ tenantId: tid, members: membersOf(tid), clinicalAccess: false })
      }
      const om = /^\/api\/platform\/tenants\/([^/]+)\/owners\/([^/]+)$/.exec(url)
      if (om && method === 'DELETE') {
        if (server.failNext) {
          const f = server.failNext
          server.failNext = null
          return j({ error: f.error }, f.status)
        }
        const tid = decodeURIComponent(om[1]!)
        const target = membersOf(tid).find((x) => x.clerkUserId === decodeURIComponent(om[2]!))
        if (target) Object.assign(target, { status: 'revoked', revokedAt: T0 })
        return j({ owner: target })
      }
      const rm = /^\/api\/platform\/tenants\/([^/]+)\/owners\/replace$/.exec(url)
      if (rm && method === 'POST') {
        if (server.failNext) {
          const f = server.failNext
          server.failNext = null
          return j({ error: f.error }, f.status)
        }
        const tid = decodeURIComponent(rm[1]!)
        const b = body as { fromClerkUserId: string; toClerkUserId: string }
        const list = membersOf(tid)
        Object.assign(list.find((x) => x.clerkUserId === b.fromClerkUserId)!, { status: 'revoked' })
        Object.assign(list.find((x) => x.clerkUserId === b.toClerkUserId)!, { role: 'owner' })
        return j({ from: {}, to: {} })
      }
      const im = /^\/api\/platform\/tenants\/([^/]+)\/invitations(?:\/([^/]+)\/(resend|cancel))?$/.exec(url)
      if (im) {
        const tid = decodeURIComponent(im[1]!)
        if (server.failNext) {
          const f = server.failNext
          server.failNext = null
          return j({ error: f.error }, f.status)
        }
        const list = (server.invitations[tid] ??= [])
        if (!im[2]) {
          const created = inv({ id: `inv_${list.length + 2}`, email: String((body as { email: string }).email) })
          server.invitations[tid] = list.filter((x) => x.expired === false).concat(created)
          return j({ invitation: created, emailSent: server.emailSent }, 201)
        }
        const target = list.find((x) => x.id === decodeURIComponent(im[2]!))
        if (!target) return j({ error: 'invitation_not_found' }, 404)
        if (im[3] === 'cancel') {
          server.invitations[tid] = list.filter((x) => x.id !== target.id)
          return j({ invitation: { ...target, status: 'cancelled' } })
        }
        return j({ invitation: target, emailSent: server.emailSent })
      }
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
          invitations: server.invitations[id] ?? [],
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
      expect(await screen.findByRole('group', { name: 'Tipo de evento' })).toBeTruthy()
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
  describe('convite de owner (DEC-194, #842)', () => {
    it('Nova clínica: valida os campos, envia nome, fuso e e-mail e abre o detalhe', async () => {
      const server = mountServer(seed())
      const user = userEvent.setup()
      await open('/admin/clinicas')
      await user.click(await screen.findByRole('link', { name: 'Nova clínica' }))
      expect(window.location.pathname).toBe('/admin/clinicas/nova')
      await user.click(await screen.findByRole('button', { name: 'Criar clínica' }))
      expect(await screen.findByText('Escreva o nome da clínica.')).toBeTruthy()
      expect(screen.getByText(/Escreva um e-mail completo/)).toBeTruthy()
      expect(server.requests.some((r) => r.method === 'POST')).toBe(false)

      await user.type(screen.getByLabelText(/^Nome da clínica/), '  Clínica Nova  ')
      await user.type(screen.getByLabelText(/^E-mail/), 'dona@example.test')
      await user.click(screen.getByRole('button', { name: 'Criar clínica' }))
      await waitFor(() => expect(window.location.pathname).toBe('/admin/clinicas/nova-id'))
      expect(server.requests.find((r) => r.method === 'POST')?.body).toEqual({
        name: 'Clínica Nova',
        timezone: 'America/Sao_Paulo',
        ownerEmail: 'dona@example.test',
      })
      expect(await screen.findByRole('heading', { level: 1, name: 'Clínica Nova' })).toBeTruthy()
      expect(screen.getAllByText('Em configuração').length).toBeGreaterThan(0)
      expect(screen.getByText('dona@example.test')).toBeTruthy()
      expect(screen.getByText(/Convite pendente · expira em/)).toBeTruthy()
    })

    it('Nova clínica: erro do servidor mostra a frase e mantém o formulário preenchido', async () => {
      const server = mountServer(seed())
      server.failNext = { status: 400, error: 'owner_email_invalid' }
      const user = userEvent.setup()
      const { container } = await open('/admin/clinicas/nova')
      await user.type(await screen.findByLabelText('Nome da clínica'), 'Clínica X')
      await user.type(screen.getByLabelText('E-mail'), 'a@b.co')
      await user.click(screen.getByRole('button', { name: 'Criar clínica' }))
      expect(await screen.findByText('Escreva um e-mail completo, como nome@clinica.com.br.')).toBeTruthy()
      expect(window.location.pathname).toBe('/admin/clinicas/nova')
      expect((screen.getByLabelText('Nome da clínica') as HTMLInputElement).value).toBe('Clínica X')
      await checkA11y(container)
    })

    it('detalhe «em configuração» com convite: mostra e-mail e prazo; reenviar confirma o envio', async () => {
      const server = mountServer(seed())
      server.invitations.jardim = [inv()]
      const user = userEvent.setup()
      await open('/admin/clinicas/jardim')
      expect(await screen.findByText('dona@example.test')).toBeTruthy()
      expect(screen.getByText(/Convite pendente · expira em 27\/10\/2026/)).toBeTruthy()
      expect(screen.getByText(/\(convite em curso\)/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Convidar owner' })).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Reenviar' }))
      expect(await screen.findByText('Convite reenviado para dona@example.test.')).toBeTruthy()
      expect(server.requests.some((r) => r.url.endsWith('/invitations/inv_1/resend'))).toBe(true)
    })

    it('se o e-mail não saiu, diz isso em vez de afirmar que foi enviado', async () => {
      const server = mountServer(seed())
      server.invitations.jardim = [inv()]
      server.emailSent = false
      const user = userEvent.setup()
      await open('/admin/clinicas/jardim')
      await user.click(await screen.findByRole('button', { name: 'Reenviar' }))
      expect(await screen.findByText(/mas o e-mail não saiu/)).toBeTruthy()
    })

    it('intervalo de reenvio devolve a frase e não muda o convite', async () => {
      const server = mountServer(seed())
      server.invitations.jardim = [inv()]
      server.failNext = { status: 409, error: 'invitation_resend_cooldown' }
      const user = userEvent.setup()
      await open('/admin/clinicas/jardim')
      await user.click(await screen.findByRole('button', { name: 'Reenviar' }))
      expect(await screen.findByText('Aguarde 10 minutos para reenviar este convite.')).toBeTruthy()
      expect(screen.getByText('dona@example.test')).toBeTruthy()
    })

    it('cancelar o convite tira-o da lista e passa a oferecer «Convidar owner»', async () => {
      const server = mountServer(seed())
      server.invitations.jardim = [inv()]
      const user = userEvent.setup()
      await open('/admin/clinicas/jardim')
      await user.click(await screen.findByRole('button', { name: 'Cancelar convite' }))
      expect(await screen.findByText('Convite para dona@example.test cancelado.')).toBeTruthy()
      await waitFor(() => expect(screen.queryByText(/Convite pendente/)).toBeNull())
      expect(await screen.findByRole('button', { name: 'Convidar owner' })).toBeTruthy()
    })

    it('convite expirado oferece «Emitir novo convite» para o mesmo e-mail', async () => {
      const server = mountServer(seed())
      server.invitations.jardim = [inv({ expired: true })]
      const user = userEvent.setup()
      await open('/admin/clinicas/jardim')
      expect(await screen.findByText(/Convite expirado em/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Reenviar' })).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Emitir novo convite' }))
      expect(await screen.findByText('Novo convite enviado para dona@example.test.')).toBeTruthy()
      expect(server.requests.find((r) => r.url.endsWith('/invitations') && r.method === 'POST')?.body).toEqual({
        email: 'dona@example.test',
      })
    })

    it('sem owner e sem convite: formulário «Convidar owner»; com owner ou suspensa não aparece', async () => {
      const server = mountServer(seed())
      const user = userEvent.setup()
      await open('/admin/clinicas/jardim')
      await user.type(await screen.findByLabelText('E-mail da owner'), 'nova.owner@example.test')
      await user.click(screen.getByRole('button', { name: 'Convidar owner' }))
      expect(await screen.findByText('Convite enviado para nova.owner@example.test.')).toBeTruthy()
      expect(server.requests.find((r) => r.url.endsWith('/invitations') && r.method === 'POST')?.body).toEqual({
        email: 'nova.owner@example.test',
      })
      cleanup()
      mountServer(seed())
      await open('/admin/clinicas/aurora')
      await screen.findByRole('heading', { level: 1, name: 'Clínica Aurora' })
      expect(screen.queryByLabelText('E-mail da owner')).toBeNull()
      cleanup()
      mountServer(seed().map((r) => (r.id === 'jardim' ? { ...r, status: 'suspended' as const } : r)))
      await open('/admin/clinicas/jardim')
      await screen.findByRole('heading', { level: 1, name: 'Clínica Jardim Sul' })
      expect(screen.queryByLabelText('E-mail da owner')).toBeNull()
    })
  })
  describe('aba Membros (#830)', () => {
    const goMembros = async (id: string) => {
      await open(`/admin/clinicas/${id}/membros`)
      return screen.findByRole('table')
    }
    const rowOf = (table: HTMLElement, text: string) =>
      within(table).getAllByRole('row').find((r) => r.textContent?.includes(text))!

    it('mostra nome e e-mail, papel e estado; só as owners têm ações', async () => {
      mountServer(seed())
      const table = await goMembros('aurora')
      const rows = within(table).getAllByRole('row').slice(1)
      expect(rows).toHaveLength(4)
      const owner = rowOf(table, 'Owner 0')
      expect(owner.textContent).toContain('owner0@example.test')
      expect(within(owner).getByText('Owner', { selector: '.admin-pill' })).toBeTruthy()
      expect(within(owner).getByRole('button', { name: 'Substituir' })).toBeTruthy()
      expect(within(owner).getByRole('button', { name: 'Remover' })).toBeTruthy()
      const att = rowOf(table, 'Attendant 2')
      expect(within(att).queryByRole('button')).toBeNull()
      expect(screen.getByRole('button', { name: 'Ativos 4' })).toBeTruthy()
    })

    it('sem nome do Clerk mostra o id e «Nome indisponível», sem bloquear', async () => {
      const server = mountServer(seed())
      server.members.aurora = [
        { tenantId: 'aurora', clerkUserId: 'user_2xk9', role: 'attendant', status: 'active', createdAt: T0, revokedAt: null, displayName: null, email: null },
        { tenantId: 'aurora', clerkUserId: 'user_o', role: 'owner', status: 'active', createdAt: T0, revokedAt: null, displayName: null, email: 'so.email@example.test' },
      ]
      const table = await goMembros('aurora')
      const nameless = rowOf(table, 'user_2xk9')
      expect(nameless.textContent).toContain('Nome indisponível')
      expect(rowOf(table, 'so.email@example.test').textContent).not.toContain('Nome indisponível')
    })

    it('filtros Ativos, Revogados e Todos; revogados não têm ações', async () => {
      const server = mountServer(seed())
      server.members.aurora = [
        { tenantId: 'aurora', clerkUserId: 'u1', role: 'owner', status: 'active', createdAt: T0, revokedAt: null, displayName: 'Ana', email: null },
        { tenantId: 'aurora', clerkUserId: 'u2', role: 'owner', status: 'active', createdAt: T0, revokedAt: null, displayName: 'Bia', email: null },
        { tenantId: 'aurora', clerkUserId: 'u3', role: 'owner', status: 'revoked', createdAt: T0, revokedAt: T0, displayName: 'Cris', email: null },
      ]
      const user = userEvent.setup()
      const table = await goMembros('aurora')
      expect(within(table).queryByText('Cris')).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Revogados 1' }))
      const only = within(screen.getByRole('table')).getAllByRole('row').slice(1)
      expect(only).toHaveLength(1)
      expect(only[0]!.textContent).toContain('Cris')
      expect(within(only[0]!).queryByRole('button')).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Todos 3' }))
      expect(within(screen.getByRole('table')).getAllByRole('row').slice(1)).toHaveLength(3)
    })

    it('a última owner ativa não pode ser removida, e diz porquê', async () => {
      mountServer(seed())
      const table = await goMembros('lume')
      const remove = within(rowOf(table, 'Owner 0')).getByRole('button', { name: 'Remover' }) as HTMLButtonElement
      expect(remove.disabled).toBe(true)
      expect(remove.title).toBe('Última owner ativa: não pode ser removida')
    })

    it('remover owner pede confirmação, chama a API e atualiza a lista', async () => {
      const server = mountServer(seed())
      const user = userEvent.setup()
      const table = await goMembros('aurora')
      await user.click(within(rowOf(table, 'Owner 1')).getByRole('button', { name: 'Remover' }))
      const dialog = await screen.findByRole('alertdialog')
      expect(dialog.textContent).toContain('Remover Owner 1 como owner?')
      await user.click(within(dialog).getByRole('button', { name: 'Remover owner' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(server.requests.some((r) => r.method === 'DELETE' && r.url.endsWith('/owners/user_owner_1'))).toBe(true)
      expect(await screen.findByText('Owner 1 deixou de ser owner.')).toBeTruthy()
      await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Owner 1')).toBeNull())
      expect(screen.getByRole('button', { name: 'Revogados 1' })).toBeTruthy()
    })

    it('erro «última owner» do servidor aparece no diálogo e nada muda', async () => {
      const server = mountServer(seed())
      server.failNext = { status: 403, error: 'last_owner_protected' }
      const user = userEvent.setup()
      const table = await goMembros('aurora')
      await user.click(within(rowOf(table, 'Owner 0')).getByRole('button', { name: 'Remover' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: 'Remover owner' }))
      expect(await within(dialog).findByRole('alert')).toBeTruthy()
      expect(dialog.textContent).toContain('Não é possível remover a última owner ativa')
      expect(dialog.textContent).not.toContain('last_owner_protected')
      // Com o diálogo aberto o resto da página fica oculto às tecnologias de apoio: usa-se o nó guardado.
      expect(within(table).getByText('Owner 0')).toBeTruthy()
    })

    it('substituir: só attendants como candidatos, escolha obrigatória, e envia de→para', async () => {
      const server = mountServer(seed())
      const user = userEvent.setup()
      const table = await goMembros('aurora')
      await user.click(within(rowOf(table, 'Owner 0')).getByRole('button', { name: 'Substituir' }))
      const dialog = await screen.findByRole('alertdialog')
      const select = within(dialog).getByLabelText(/Substituir por/)
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Escolher…',
        'Attendant 2',
        'Attendant 3',
      ])
      await user.click(within(dialog).getByRole('button', { name: 'Substituir owner' }))
      expect(await within(dialog).findByText('Escolha quem passa a ser owner.')).toBeTruthy()
      expect(server.requests.some((r) => r.url.endsWith('/owners/replace'))).toBe(false)
      await user.selectOptions(select, 'user_att_3')
      await user.click(within(dialog).getByRole('button', { name: 'Substituir owner' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(server.requests.find((r) => r.url.endsWith('/owners/replace'))?.body).toEqual({
        fromClerkUserId: 'user_owner_0',
        toClerkUserId: 'user_att_3',
      })
      expect(await screen.findByText(/a nova owner foi promovida/)).toBeTruthy()
    })

    it('sem attendants não há quem promover: Substituir fica desativado', async () => {
      mountServer(seed())
      const table = await goMembros('lume')
      const lone = rowOf(table, 'Owner 0')
      expect((within(lone).getByRole('button', { name: 'Substituir' }) as HTMLButtonElement).disabled).toBe(false)
      cleanup()
      const server = mountServer(seed())
      server.members.aurora = [
        { tenantId: 'aurora', clerkUserId: 'u1', role: 'owner', status: 'active', createdAt: T0, revokedAt: null, displayName: 'Só Owner', email: null },
      ]
      const t2 = await goMembros('aurora')
      const btn = within(rowOf(t2, 'Só Owner')).getByRole('button', { name: 'Substituir' }) as HTMLButtonElement
      expect(btn.disabled).toBe(true)
      expect(btn.title).toBe('Não há attendants para promover')
    })

    it('adicionar owner: valida o e-mail e envia o convite; diz quando o e-mail não saiu', async () => {
      const server = mountServer(seed())
      const user = userEvent.setup()
      await goMembros('aurora')
      await user.click(screen.getByRole('button', { name: 'Adicionar owner' }))
      const dialog = await screen.findByRole('dialog')
      await user.type(within(dialog).getByLabelText(/E-mail da owner/), 'sem-arroba')
      await user.click(within(dialog).getByRole('button', { name: 'Enviar convite' }))
      expect(await within(dialog).findByText(/Escreva um e-mail completo/)).toBeTruthy()
      expect(server.requests.some((r) => r.url.endsWith('/invitations'))).toBe(false)

      server.emailSent = false
      await user.clear(within(dialog).getByLabelText(/E-mail da owner/))
      await user.type(within(dialog).getByLabelText(/E-mail da owner/), 'nova@example.test')
      await user.click(within(dialog).getByRole('button', { name: 'Enviar convite' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(server.requests.find((r) => r.url.endsWith('/invitations'))?.body).toEqual({ email: 'nova@example.test' })
      expect(await screen.findByText(/mas o e-mail não saiu/)).toBeTruthy()
    })

    it('convite de owner em curso aparece na tabela como «Convite enviado»', async () => {
      const server = mountServer(seed())
      server.invitations.jardim = [inv()]
      const table = await goMembros('jardim')
      const row = rowOf(table, 'dona@example.test')
      expect(within(row).getByText('Convite enviado')).toBeTruthy()
      expect(row.textContent).toContain('Ainda não aceitou')
      expect(within(row).queryByRole('button')).toBeNull()
    })

    it('clínica em exclusão pendente não oferece ações nem «Adicionar owner»', async () => {
      mountServer(seed())
      const table = await goMembros('pele')
      expect(within(table).queryByRole('button', { name: 'Remover' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Adicionar owner' })).toBeNull()
    })

    it('acessibilidade: a aba e o diálogo não têm violações', async () => {
      mountServer(seed())
      const user = userEvent.setup()
      const { container } = await open('/admin/clinicas/aurora/membros')
      const table = await screen.findByRole('table')
      await checkA11y(container)
      await user.click(within(rowOf(table, 'Owner 0')).getByRole('button', { name: 'Substituir' }))
      await screen.findByRole('alertdialog')
      await checkA11y(document.body)
    })
  })
})
