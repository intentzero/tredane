import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../ui/panel.css'
import { writeSynthUserId } from './auth/session'
import { PanelApp } from './PanelApp'

async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  })
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
}

function mockApis(opts: {
  tenants: Array<{
    tenantId: string
    name: string
    role: 'owner' | 'attendant'
    status: 'active'
  }>
  contextById?: Record<
    string,
    { tenantId: string; name: string; status: 'active'; role: 'owner' | 'attendant' }
  >
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/client-config')) {
        return new Response(
          JSON.stringify({ authMode: 'synthetic', clerkPublishableKey: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/me')) {
        return new Response(
          JSON.stringify({
            kind: 'human',
            clerkUserId: 'user_synth_multi',
            sessionId: 'sess',
            isSuperadmin: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/me/tenants')) {
        return new Response(JSON.stringify({ tenants: opts.tenants }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const ctxMatch = /\/api\/tenants\/([^/]+)\/context/.exec(url)
      if (ctxMatch) {
        const id = decodeURIComponent(ctxMatch[1] ?? '')
        const ctx = opts.contextById?.[id]
        if (!ctx) {
          return new Response(JSON.stringify({ error: 'tenant_access_denied' }), { status: 403 })
        }
        return new Response(JSON.stringify(ctx), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (/\/api\/tenants\/[^/]+\/config\/abuse-limits/.test(url)) {
        const limits = {
          windowHours: 24,
          autoDraftsPerContact: 20,
          aiBookingsPerContact: 1,
          aiBookingsPerClinic: 20,
          futureAppointmentsPerContact: 3,
          pendingPixPerContact: 2,
          pendingProposalsPerContact: 1,
          proposalsPerContact: 5,
          proposalsPerClinic: 100,
        }
        return new Response(
          JSON.stringify({
            enabled: false,
            autoBookPaused: false,
            limits,
            defaults: limits,
            caps: {
              windowHours: 168,
              autoDraftsPerContact: 200,
              aiBookingsPerContact: 20,
              aiBookingsPerClinic: 500,
              futureAppointmentsPerContact: 20,
              pendingPixPerContact: 20,
              pendingProposalsPerContact: 10,
              proposalsPerContact: 50,
              proposalsPerClinic: 1000,
            },
            platformCeilings: {
              windowHours: 168,
              autoDraftsPerContact: 200,
              aiBookingsPerContact: 20,
              aiBookingsPerClinic: 500,
              futureAppointmentsPerContact: 20,
              pendingPixPerContact: 20,
              pendingProposalsPerContact: 10,
              proposalsPerContact: 50,
              proposalsPerClinic: 1000,
            },
            effective: { enabled: false, ...limits },
            updatedAt: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (/\/api\/tenants\/[^/]+\/inbox\/contacts(?:\?|$)/.test(url)) {
        return new Response(JSON.stringify({ contacts: [], nextBefore: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (/\/api\/tenants\/[^/]+\/config(?:\?|$)/.test(url)) {
        return new Response(
          JSON.stringify({
            settings: {
              tenantId: 'clinic-demo-a',
              timezone: 'America/Sao_Paulo',
              updatedAt: 0,
            },
            services: [],
            resources: [],
            weeklyWindows: [],
            blocks: [],
            readiness: {
              agendaConfigured: false,
              readyToServe: false,
              schedulingAllowed: false,
              missing: [
                'service',
                'professional',
                'room_or_equipment',
                'weekly_availability',
                'whatsapp',
              ],
              timezone: 'America/Sao_Paulo',
              counts: {
                servicesActive: 0,
                professionalsActive: 0,
                roomsActive: 0,
                resourcesWithWeekly: 0,
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
    }),
  )
}

describe('panel shell (#22)', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    sessionStorage.clear()
    writeSynthUserId(null)
    window.history.replaceState(null, '', '/entrar')
  })

  it('login synthetic → seletor multi-clínica → nav owner com Clínica e título Acompanhamento', async () => {
    const user = userEvent.setup()
    mockApis({
      tenants: [
        {
          tenantId: 'clinic-demo-a',
          name: 'Clínica Aurora (fictícia)',
          role: 'owner',
          status: 'active',
        },
        {
          tenantId: 'clinic-demo-b',
          name: 'Estúdio Horizonte (fictício)',
          role: 'attendant',
          status: 'active',
        },
      ],
      contextById: {
        'clinic-demo-a': {
          tenantId: 'clinic-demo-a',
          name: 'Clínica Aurora (fictícia)',
          status: 'active',
          role: 'owner',
        },
      },
    })

    const { container } = render(<PanelApp />)

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy()
    await user.type(screen.getByLabelText('E-mail'), 'renata@exemplo.clinica')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await user.type(screen.getByLabelText('Código de 6 dígitos'), '123456')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    await user.click(await screen.findByText('Renata (multi-clínica)'))

    expect(await screen.findByRole('heading', { name: 'Escolha a clínica' })).toBeTruthy()
    await user.click(screen.getByText('Clínica Aurora (fictícia)'))

    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeTruthy()
    const nav = screen.getByRole('navigation', { name: 'Áreas' })
    expect(within(nav).getByText('Acompanhar')).toBeTruthy()
    expect(within(nav).getByText('Clientes')).toBeTruthy()
    expect(within(nav).getByText('Clínica')).toBeTruthy()

    await user.click(within(nav).getByText('Acompanhar'))
    expect(await screen.findByRole('heading', { name: 'Acompanhamento' })).toBeTruthy()

    await user.click(within(nav).getByText('Clientes'))
    expect(await screen.findByRole('heading', { name: 'Clientes' })).toBeTruthy()
    expect(
      await screen.findByRole('searchbox', { name: 'Buscar nome ou telefone' }),
    ).toBeTruthy()

    await user.click(within(nav).getByText('Clínica'))
    expect(
      await screen.findByRole('heading', { name: /passos? para atender/i }),
    ).toBeTruthy()
    expect(screen.getByText('4 · Serviços')).toBeTruthy()

    await expectNoAxeViolations(container)
  })

  it('attendant não vê aba Clínica; URL direta mostra sem permissão', async () => {
    writeSynthUserId('user_synth_attendant_a')
    window.history.replaceState(null, '', '/c/clinic-demo-a/clinica')
    mockApis({
      tenants: [
        {
          tenantId: 'clinic-demo-a',
          name: 'Clínica Aurora (fictícia)',
          role: 'attendant',
          status: 'active',
        },
      ],
      contextById: {
        'clinic-demo-a': {
          tenantId: 'clinic-demo-a',
          name: 'Clínica Aurora (fictícia)',
          status: 'active',
          role: 'attendant',
        },
      },
    })

    render(<PanelApp />)

    expect(
      await screen.findByRole('heading', { name: 'Você não tem acesso a esta área' }),
    ).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Áreas' })).toBeNull()
  })
})
