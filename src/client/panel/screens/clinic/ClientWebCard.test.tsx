import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelApiError, type PanelApi } from '../../api'
import { ClientWebCard } from './ClientWebCard'

afterEach(cleanup)

function fakeApi(over: Partial<Record<'get' | 'set', unknown>> = {}) {
  const set = vi.fn(async (_t: string, enabled: boolean) => ({ enabled, updatedAt: 1 }))
  const api = {
    getClientWebSetting: over.get ?? (async () => ({ enabled: false, available: true, updatedAt: null })),
    setClientWebEnabled: over.set ?? set,
  } as unknown as PanelApi
  return { api, set }
}

describe('ClientWebCard (DEC-199)', () => {
  it('mostra o interruptor desligado e liga ao tocar', async () => {
    const user = userEvent.setup()
    const { api, set } = fakeApi()
    render(<ClientWebCard tenantId="clinic-demo-a" api={api} generation={1} />)
    const sw = await screen.findByRole('switch', { name: 'Oferecer o agendamento por link' })
    expect((sw as HTMLInputElement).checked).toBe(false)
    await user.click(sw)
    await waitFor(() => expect(set).toHaveBeenCalledWith('clinic-demo-a', true, expect.anything()))
    expect(await screen.findByText('Página de agendamento ligada.')).toBeTruthy()
    expect((sw as HTMLInputElement).checked).toBe(true)
  })

  it('se salvar falha, volta ao estado anterior e avisa', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi({ set: async () => { throw new PanelApiError(500, 'unauthenticated') } })
    render(<ClientWebCard tenantId="clinic-demo-a" api={api} generation={1} />)
    const sw = await screen.findByRole('switch', { name: 'Oferecer o agendamento por link' })
    await user.click(sw)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect((sw as HTMLInputElement).checked).toBe(false)
  })

  it('sem permissão (403) o cartão não aparece; ambiente sem a função desativa o interruptor', async () => {
    const forbidden = fakeApi({ get: async () => { throw new PanelApiError(403, 'permission_denied') } })
    const { container } = render(<ClientWebCard tenantId="clinic-demo-a" api={forbidden.api} generation={1} />)
    await waitFor(() => expect(container.querySelector('section')).toBeNull())
    cleanup()
    const off = fakeApi({ get: async () => ({ enabled: false, available: false, updatedAt: null }) })
    render(<ClientWebCard tenantId="clinic-demo-a" api={off.api} generation={1} />)
    const sw = await screen.findByRole('switch', { name: 'Oferecer o agendamento por link' })
    expect((sw as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/ainda não está disponível neste ambiente/)).toBeTruthy()
  })

  it('sem violações de acessibilidade (axe)', async () => {
    const { api } = fakeApi()
    const { container } = render(<ClientWebCard tenantId="clinic-demo-a" api={api} generation={1} />)
    await screen.findByRole('switch', { name: 'Oferecer o agendamento por link' })
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(res.violations.map((v) => v.id)).toEqual([])
  })
})
