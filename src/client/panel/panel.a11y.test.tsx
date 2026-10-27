/**
 * Acessibilidade do painel — axe + teclado/landmarkas (sem Playwright / aparelho real).
 * Contraste CSS: docs/design/tools/check_contrast.py. Q-UX-01 / UX-08 em aparelho: Em aberto.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../ui/panel.css'
import { DeleteContactDialog } from './screens/inbox/DeleteContactDialog'
import { MoveSheet } from './screens/acompanhamento/MoveSheet'
import { writeSynthUserId } from './auth/session'
import { PanelApp } from './PanelApp'

async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      // jsdom não calcula contraste de forma fiável; contraste via check_contrast.py
      'color-contrast': { enabled: false },
    },
  })
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
}

function mockApis() {
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
      if (url.includes('/api/me/tenants')) {
        return new Response(
          JSON.stringify({
            tenants: [
              {
                tenantId: 'clinic-demo-a',
                name: 'Clínica Aurora (fictícia)',
                role: 'owner',
                status: 'active',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/api/me')) {
        return new Response(
          JSON.stringify({
            kind: 'human',
            clerkUserId: 'user_synth_owner_a',
            sessionId: 'sess',
            isSuperadmin: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (/\/api\/tenants\/[^/]+\/context/.test(url)) {
        return new Response(
          JSON.stringify({
            tenantId: 'clinic-demo-a',
            name: 'Clínica Aurora (fictícia)',
            status: 'active',
            role: 'owner',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (/\/api\/tenants\/[^/]+\/config/.test(url)) {
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
              missing: ['service'],
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
      if (/\/api\/tenants\/[^/]+\/inbox\/conversations/.test(url)) {
        return new Response(
          JSON.stringify({
            conversations: [],
            counts: { all: 0, new: 0, mine: 0, unassigned: 0, closed: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (/\/api\/tenants\/[^/]+\/whatsapp/.test(url)) {
        return new Response(
          JSON.stringify({
            status: 'disconnected',
            connection: null,
            templates: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (/\/api\/tenants\/[^/]+\/inbox/.test(url)) {
        return new Response(
          JSON.stringify({
            conversations: [],
            counts: { all: 0, new: 0, mine: 0, unassigned: 0, closed: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      // Demais endpoints do shell (push, etc.) — resposta neutra.
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

describe('painel a11y — shell e diálogos', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    sessionStorage.clear()
    writeSynthUserId(null)
  })

  it('shell com skip link, main e nav; axe limpo na lista de conversas', async () => {
    sessionStorage.clear()
    writeSynthUserId('user_synth_owner_a')
    window.history.replaceState(null, '', '/c/clinic-demo-a/conversas')
    mockApis()

    const { container } = render(<PanelApp />)

    expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeTruthy()
    const skip = screen.getByRole('link', { name: 'Saltar para o conteúdo' })
    expect(skip.getAttribute('href')).toBe('#panel-main')
    expect(document.getElementById('panel-main')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Áreas' })).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()

    const filters = await screen.findByRole('toolbar', {
      name: 'Filtros da caixa de entrada',
    })
    expect(
      within(filters).getByRole('button', { name: 'Todas' }).getAttribute('aria-pressed'),
    ).toBe('true')

    await expectNoAxeViolations(container)
  })

  it('DeleteContactDialog: alertdialog com descrição; Esc fecha; foco no Cancelar', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    const { container } = render(
      <div className="panel-root">
        <DeleteContactDialog
          open
          contactLabel="Ana Fictícia"
          busy={false}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      </div>,
    )

    const dialog = await screen.findByRole('alertdialog', {
      name: 'Excluir contato?',
    })
    expect(dialog.getAttribute('aria-describedby')).toBe('delete-contact-desc')
    expect(screen.getByText(/Remove mensagens e anexos/)).toBeTruthy()

    const cancel = screen.getByRole('button', { name: 'Cancelar' })
    expect(document.activeElement).toBe(cancel)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()

    await expectNoAxeViolations(container)
  })

  it('MoveSheet: diálogo React Aria com título e Esc fecha', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <div className="panel-root">
        <MoveSheet
          open
          contactName="Bruno Demo"
          currentStage="novo_contato"
          busy={false}
          onClose={onClose}
          onMove={vi.fn()}
        />
      </div>,
    )

    expect(
      await screen.findByRole('dialog', { name: /Mover Bruno Demo para/ }),
    ).toBeTruthy()
    expect(screen.getByText(/Etapa atual:/)).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
