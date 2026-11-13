// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi, PixSnapshot } from '../../../api'
import '../../../../ui/panel.css'
import { RecebimentoScreen } from './RecebimentoScreen'
import { buildSignalPolicyPreview } from '../../../../../clinic/pix/signal-policy-text'

afterEach(cleanup)

function snapshot(over: Partial<PixSnapshot['signalSettings']> = {}): PixSnapshot {
  const base = {
    enabled: true,
    amountKind: 'fixed' as const,
    fixedCents: 5000,
    percent: null,
    deadlineSeconds: 7200,
    policyKind: 'credit_next' as const,
    creditWindowHours: 24 as const,
    customPolicyText: '',
    cancellationPolicy: '',
    updatedAt: 1,
  }
  const merged = { ...base, ...over }
  const preview = buildSignalPolicyPreview({
    amountKind: merged.amountKind,
    fixedCents: merged.fixedCents,
    percent: merged.percent,
    deadlineSeconds: merged.deadlineSeconds,
    policyKind: merged.policyKind,
    creditWindowHours: merged.creditWindowHours,
    customPolicyText: merged.customPolicyText,
  })
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
      ...merged,
      cancellationPolicy: merged.cancellationPolicy || preview.combined,
      preview,
    },
  }
}

function api(snap: PixSnapshot = snapshot()): PanelApi & {
  updatePixSignalSettings: ReturnType<typeof vi.fn>
} {
  const updatePixSignalSettings = vi.fn(async (_t: string, body: Record<string, unknown>) => {
    const next = snapshot({
      ...snap.signalSettings,
      ...(body as Partial<PixSnapshot['signalSettings']>),
    })
    return next.signalSettings
  })
  return {
    getPix: vi.fn(async () => snap),
    connectPix: vi.fn(),
    disconnectPix: vi.fn(),
    updatePixSignalSettings,
  } as unknown as PanelApi & { updatePixSignalSettings: ReturnType<typeof vi.fn> }
}

describe('RecebimentoScreen — cartão unificado (DEC-180)', () => {
  it('mostra o cartão do sinal com 2 h e salva regras globais', async () => {
    const client = api()
    render(<RecebimentoScreen tenantId="clinic-demo-a" api={client} generation={1} />)

    expect(await screen.findByRole('heading', { name: 'Sinal para reservar o horário' })).toBeTruthy()
    const group = screen.getByRole('group', { name: 'Presets de prazo' })
    expect(within(group).getByRole('button', { name: '2 h' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByText(/Prévia automática/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Salvar regras do sinal' }))
    await waitFor(() =>
      expect(client.updatePixSignalSettings).toHaveBeenCalledWith(
        'clinic-demo-a',
        expect.objectContaining({
          enabled: true,
          amountKind: 'fixed',
          fixedCents: 5000,
          deadlineSeconds: 7200,
          policyKind: 'credit_next',
          creditWindowHours: 24,
        }),
        expect.anything(),
      ),
    )
  })

  it('prazo Outro… fora de 15 min–48 h desabilita Salvar', async () => {
    const client = api()
    render(<RecebimentoScreen tenantId="clinic-demo-a" api={client} generation={1} />)

    await screen.findByRole('button', { name: '2 h' })
    await userEvent.click(screen.getByRole('button', { name: 'Outro…' }))
    const custom = screen.getByLabelText('Prazo personalizado')
    await userEvent.clear(within(custom).getByLabelText('Número'))
    await userEvent.type(within(custom).getByLabelText('Número'), '5')
    expect(
      (screen.getByRole('button', { name: 'Salvar regras do sinal' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('desligado esconde valor e política mas permite salvar', async () => {
    const client = api(snapshot({ enabled: true }))
    render(<RecebimentoScreen tenantId="clinic-demo-a" api={client} generation={1} />)
    await screen.findByRole('heading', { name: 'Sinal para reservar o horário' })
    await userEvent.click(screen.getByRole('switch', { name: 'Pedir sinal ao agendar' }))
    expect(screen.queryByText(/Valor do sinal/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Salvar regras do sinal' }))
    await waitFor(() =>
      expect(client.updatePixSignalSettings).toHaveBeenCalledWith(
        'clinic-demo-a',
        expect.objectContaining({ enabled: false }),
        expect.anything(),
      ),
    )
  })
})
