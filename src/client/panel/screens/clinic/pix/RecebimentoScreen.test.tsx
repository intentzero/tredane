// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi, PixSnapshot } from '../../../api'
import '../../../../ui/panel.css'
import { RecebimentoScreen } from './RecebimentoScreen'

afterEach(cleanup)

function snapshot(over: Partial<PixSnapshot['signalSettings']> = {}): PixSnapshot {
  return {
    account: {
      provider: 'woovi',
      status: 'connected',
      appIdHint: '****a3f2',
      credentialVersion: 1,
      environment: 'synthetic',
      canCreateCharge: true,
      accountId: 'acc1',
      connectedAt: 1,
      connectedByClerkUserId: 'user_synth_owner_a',
      disconnectedAt: null,
      revokedAt: null,
      revokeReason: null,
      updatedAt: 1,
    },
    signalSettings: {
      deadlineSeconds: 7200,
      cancellationPolicy: 'Cancelamento com devolução até 24 h antes.',
      updatedAt: 1,
      ...over,
    },
  }
}

function api(snap: PixSnapshot = snapshot()): PanelApi & {
  updatePixSignalSettings: ReturnType<typeof vi.fn>
} {
  const updatePixSignalSettings = vi.fn(
    async (_t: string, body: { deadlineSeconds?: number; cancellationPolicy?: string }) => ({
      ...snap.signalSettings,
      deadlineSeconds: body.deadlineSeconds ?? snap.signalSettings.deadlineSeconds,
      cancellationPolicy:
        body.cancellationPolicy ?? snap.signalSettings.cancellationPolicy,
      updatedAt: Date.now(),
    }),
  )
  return {
    getPix: vi.fn(async () => snap),
    connectPix: vi.fn(),
    disconnectPix: vi.fn(),
    updatePixSignalSettings,
  } as unknown as PanelApi & { updatePixSignalSettings: ReturnType<typeof vi.fn> }
}

describe('RecebimentoScreen — prazo presets (DEC-179)', () => {
  it('mostra 2 h selecionado por padrão e salva em segundos', async () => {
    const client = api()
    render(<RecebimentoScreen tenantId="clinic-demo-a" api={client} generation={1} />)

    const group = await screen.findByRole('group', { name: 'Presets de prazo' })
    expect(within(group).getByRole('button', { name: '2 h' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(within(group).getByRole('button', { name: '15 min' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(screen.queryByLabelText('Prazo personalizado')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Salvar prazo e política' }))
    await waitFor(() =>
      expect(client.updatePixSignalSettings).toHaveBeenCalledWith(
        'clinic-demo-a',
        expect.objectContaining({ deadlineSeconds: 7200 }),
        expect.anything(),
      ),
    )
  })

  it('Outro… abre número + unidade e desabilita Salvar fora de 15 min–48 h', async () => {
    const client = api()
    render(<RecebimentoScreen tenantId="clinic-demo-a" api={client} generation={1} />)

    await screen.findByRole('button', { name: '2 h' })
    await userEvent.click(screen.getByRole('button', { name: 'Outro…' }))

    const custom = screen.getByLabelText('Prazo personalizado')
    expect(within(custom).getByDisplayValue('90')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'min' }).getAttribute('data-selected')).toBe('true')

    const save = screen.getByRole('button', { name: 'Salvar prazo e política' })
    expect((save as HTMLButtonElement).disabled).toBe(false)

    await userEvent.clear(within(custom).getByLabelText('Número'))
    await userEvent.type(within(custom).getByLabelText('Número'), '5')
    expect((save as HTMLButtonElement).disabled).toBe(true)

    await userEvent.clear(within(custom).getByLabelText('Número'))
    await userEvent.type(within(custom).getByLabelText('Número'), '90')
    expect((save as HTMLButtonElement).disabled).toBe(false)

    await userEvent.click(save)
    await waitFor(() =>
      expect(client.updatePixSignalSettings).toHaveBeenCalledWith(
        'clinic-demo-a',
        expect.objectContaining({ deadlineSeconds: 5400 }),
        expect.anything(),
      ),
    )
  })

  it('valor guardado fora dos presets abre Outro… com unidade correcta', async () => {
    const client = api(snapshot({ deadlineSeconds: 5400 }))
    render(<RecebimentoScreen tenantId="clinic-demo-a" api={client} generation={1} />)

    const group = await screen.findByRole('group', { name: 'Presets de prazo' })
    expect(within(group).getByRole('button', { name: 'Outro…' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(within(group).getByRole('button', { name: '2 h' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(screen.getByDisplayValue('90')).toBeTruthy()
  })

  it('escolhe 30 min e envia 1800 segundos', async () => {
    const client = api()
    render(<RecebimentoScreen tenantId="clinic-demo-a" api={client} generation={1} />)

    await screen.findByRole('button', { name: '2 h' })
    await userEvent.click(screen.getByRole('button', { name: '30 min' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar prazo e política' }))

    await waitFor(() =>
      expect(client.updatePixSignalSettings).toHaveBeenCalledWith(
        'clinic-demo-a',
        expect.objectContaining({ deadlineSeconds: 1800 }),
        expect.anything(),
      ),
    )
  })
})
