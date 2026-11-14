// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShellSlotProvider } from '../../shell/ShellSlot'
import { ClinicListHeader } from './ClinicListHeader'
import { ClinicPageHeader } from './ClinicPageHeader'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function viewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide && query.includes('1280px'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

function Shell({ children }: { children: React.ReactNode }) {
  // O cabeçalho do shell: o espaço livre que a Clínica passa a usar (DEC-183).
  const slot = document.createElement('div')
  slot.setAttribute('data-testid', 'slot')
  document.body.appendChild(slot)
  return <ShellSlotProvider value={slot}>{children}</ShellSlotProvider>
}

describe('Clínica: título, contexto e ação no cabeçalho (DEC-183)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('desktop: título e ação vão para o cabeçalho; o corpo fica só com a frase', () => {
    viewport(true)
    render(
      <Shell>
        <ClinicPageHeader title="Equipe" description="Quem entra no painel." action={<button type="button">Convidar pessoa</button>} />
      </Shell>,
    )
    const slot = screen.getByTestId('slot')
    expect(within(slot).getByRole('heading', { name: 'Equipe', level: 2 })).toBeTruthy()
    expect(within(slot).getByRole('button', { name: 'Convidar pessoa' })).toBeTruthy()
    expect(screen.getByText('Quem entra no painel.').closest('[data-testid="slot"]')).toBeNull()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('celular: cabeçalho de página como antes (título e ação no corpo)', () => {
    viewport(false)
    render(
      <Shell>
        <ClinicPageHeader title="Equipe" description="Quem entra no painel." action={<button type="button">Convidar pessoa</button>} />
      </Shell>,
    )
    expect(screen.getByRole('heading', { name: 'Equipe', level: 1 })).toBeTruthy()
    expect(within(screen.getByTestId('slot')).queryByRole('heading')).toBeNull()
  })

  it('desktop: contagem, chave e Adicionar das listas ficam depois do título, no cabeçalho', () => {
    viewport(true)
    render(
      <Shell>
        <ClinicPageHeader title="Serviços" description="O que a clínica oferece." />
        <ClinicListHeader count="3 serviços ativos" switchLabel="Mostrar inativos" showInactive={false} onShowInactive={() => {}} addLabel="Adicionar serviço" onAdd={() => {}} />
      </Shell>,
    )
    const slot = screen.getByTestId('slot')
    const kids = Array.from(slot.children)
    expect(kids[0]?.textContent).toBe('Serviços')
    expect(within(slot).getByText('3 serviços ativos')).toBeTruthy()
    expect(within(slot).getByRole('button', { name: 'Adicionar serviço' })).toBeTruthy()
  })

  it('celular: a lista mantém o seu cabeçalho no corpo', () => {
    viewport(false)
    render(
      <Shell>
        <ClinicListHeader count="3 serviços ativos" switchLabel="Mostrar inativos" showInactive={false} onShowInactive={() => {}} addLabel="Adicionar serviço" onAdd={() => {}} />
      </Shell>,
    )
    expect(within(screen.getByTestId('slot')).queryByText('3 serviços ativos')).toBeNull()
    expect(screen.getByText('3 serviços ativos')).toBeTruthy()
  })

  it('desktop: a busca da lista fica no cabeçalho, entre a contagem e a ação', () => {
    viewport(true)
    render(
      <Shell>
        <ClinicListHeader count="8 serviços ativos" switchLabel="Mostrar inativos" showInactive={false} onShowInactive={() => {}} addLabel="Adicionar serviço" onAdd={() => {}} search={<input aria-label="Buscar serviço" />} />
      </Shell>,
    )
    const slot = screen.getByTestId('slot')
    const count = within(slot).getByText('8 serviços ativos')
    const search = within(slot).getByLabelText('Buscar serviço')
    const add = within(slot).getByRole('button', { name: 'Adicionar serviço' })
    expect(count.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(search.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('celular: o cabeçalho da lista não leva a busca (ela fica na linha própria)', () => {
    viewport(false)
    render(
      <Shell>
        <ClinicListHeader count="8 serviços ativos" switchLabel="Mostrar inativos" showInactive={false} onShowInactive={() => {}} addLabel="Adicionar serviço" onAdd={() => {}} search={<input aria-label="Buscar serviço" />} />
      </Shell>,
    )
    expect(screen.queryByLabelText('Buscar serviço')).toBeNull()
  })
})
