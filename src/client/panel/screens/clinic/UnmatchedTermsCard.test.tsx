import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClinicService, PanelApi, UnmatchedTermSuggestion } from '../../api'
import { UnmatchedTermsCard } from './UnmatchedTermsCard'

afterEach(cleanup)

const services = [
  { id: 'svc_dep', name: 'Depilação', active: true },
  { id: 'svc_lp', name: 'Limpeza de pele', active: true },
] as unknown as ClinicService[]

const items: UnmatchedTermSuggestion[] = [
  { id: 'umt_1', term: 'depilar', hits: 3, firstSeenAt: 1, lastSeenAt: 2, suggestedServiceId: 'svc_dep' },
  { id: 'umt_2', term: 'sobrancelha', hits: 1, firstSeenAt: 1, lastSeenAt: 1, suggestedServiceId: null },
]

function fakeApi() {
  const accept = vi.fn(async (_t: string, _id: string, serviceId: string) =>
    services.find((s) => s.id === serviceId)!,
  )
  const dismiss = vi.fn(async (_t: string, id: string) => ({ ok: true as const, id }))
  const api = {
    listUnmatchedTerms: async () => items,
    acceptUnmatchedTerm: accept,
    dismissUnmatchedTerm: dismiss,
  } as unknown as PanelApi
  return { api, accept, dismiss }
}

describe('UnmatchedTermsCard (DEC-141)', () => {
  it('grava com um toque no serviço provável e descarta o resto', async () => {
    const user = userEvent.setup()
    const { api, accept, dismiss } = fakeApi()
    const onSaved = vi.fn()
    render(
      <UnmatchedTermsCard tenantId="t" api={api} generation={1} services={services} onSaved={onSaved} />,
    )
    expect(await screen.findByText('«depilar»')).toBeTruthy()
    expect(screen.getByText('3 vezes')).toBeTruthy()
    // Sem serviço provável, gravar espera a escolha.
    const buttons = screen.getAllByRole('button', { name: 'Gravar' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.hasAttribute('disabled') || buttons[0]!.getAttribute('data-disabled') != null).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Gravar em Depilação' }))
    expect(accept).toHaveBeenCalledWith('t', 'umt_1', 'svc_dep', expect.anything())
    expect(onSaved).toHaveBeenCalled()
    expect(await screen.findByText('«depilar» gravado em Depilação.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(dismiss).toHaveBeenCalledWith('t', 'umt_2', expect.anything())
    expect(screen.queryByRole('heading', { name: 'Palavras que a assistente não reconheceu' })).toBeNull()
    expect(screen.getByText('«sobrancelha» descartado.')).toBeTruthy()
  })

  it('sem sugestões não mostra nada', async () => {
    const api = { listUnmatchedTerms: async () => [] } as unknown as PanelApi
    const { container } = render(
      <UnmatchedTermsCard tenantId="t" api={api} generation={1} services={services} onSaved={() => {}} />,
    )
    await Promise.resolve()
    expect(container.textContent).toBe('')
  })
})
