// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import { ShellSlotProvider } from '../../shell/ShellSlot'
import { AiProfileCard } from './AiAssistCard'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup(wide: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: wide && q.includes('1280px'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  const slot = document.createElement('div')
  document.body.appendChild(slot)
  const setProfile = vi.fn(async () => ({ ok: true }))
  const api = {
    setClinicAiAssist: vi.fn(),
    setClinicAiProfile: setProfile,
    getPix: vi.fn(async () => ({ signalSettings: { enabled: false, cancellationPolicy: '' } })),
  } as unknown as PanelApi
  render(
    <ShellSlotProvider value={slot}>
      <AiProfileCard
        tenantId="clinic-demo-a"
        api={api}
        generation={1}
        initialGoogleBusinessUrl="https://maps.app.goo.gl/x"
        initialReschedulePolicy="Avise com 24 h."
      />
    </ShellSlotProvider>,
  )
  // Resumo → Editar para expor os campos e a barra DEC-183
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
  return { slot, setProfile }
}

describe('Assistente: Salvar e Descartar no cabeçalho (DEC-183)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('desktop: sem alterações os botões estão desativados e não há aviso', () => {
    const { slot } = setup(true)
    expect(
      within(slot).getByRole('button', { name: 'Salvar localização e regras' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(within(slot).queryByText('Alterações por salvar')).toBeNull()
  })

  it('desktop: editar mostra o aviso, ativa Salvar, e Descartar repõe o valor', () => {
    const { slot } = setup(true)
    const policy = screen.getByLabelText(/Regras gerais/) as HTMLTextAreaElement
    fireEvent.change(policy, { target: { value: 'Avise com 48 h.' } })
    expect(within(slot).getByText('Alterações por salvar')).toBeTruthy()
    expect(
      within(slot).getByRole('button', { name: 'Salvar localização e regras' }).hasAttribute('disabled'),
    ).toBe(false)
    fireEvent.click(within(slot).getByRole('button', { name: 'Descartar' }))
    expect((screen.getByLabelText(/Regras gerais/) as HTMLTextAreaElement).value).toBe(
      'Avise com 24 h.',
    )
    expect(within(slot).queryByText('Alterações por salvar')).toBeNull()
  })

  it('celular: o botão continua dentro do cartão', () => {
    const { slot } = setup(false)
    expect(
      within(slot).queryByRole('button', { name: 'Salvar localização e regras' }),
    ).toBeNull()
    expect(screen.getByRole('button', { name: 'Salvar localização e regras' })).toBeTruthy()
  })
})
