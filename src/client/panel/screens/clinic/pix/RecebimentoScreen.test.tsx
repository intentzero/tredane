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
    deadlineSeconds: 1800,
    policyKind: 'credit_next' as const,
    creditWindowMinutes: 24 * 60,
    creditWindowHours: 24,
    bookingLeadMinutes: 0,
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
    creditWindowMinutes: merged.creditWindowMinutes,
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

describe('RecebimentoScreen — cartão unificado (DEC-180 / DEC-182)', () => {
  it('mostra prazo 30 min, antecedência Desligado e salva regras', async () => {
    const client = api()
    render(<RecebimentoScreen tenantId="clinic-demo-a" api={client} generation={1} />)

    expect(await screen.findByRole('heading', { name: 'Sinal para reservar o horário' })).toBeTruthy()
    const group = screen.getByRole('group', { name: 'Presets de prazo' })
    expect(within(group).getByRole('button', { name: '30 min' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(within(group).queryByRole('button', { name: '2 h' })).toBeNull()
    expect(within(group).queryByRole('button', { name: 'Outro…' })).toBeNull()

    const lead = screen.getByRole('group', { name: 'Antecedência mínima' })
    expect(within(lead).getByRole('button', { name: 'Desligado' }).getAttribute('aria-pressed')).toBe(
      'true',
    )

    expect(screen.getByText(/Prévia automática/)).toBeTruthy()
    expect(screen.getByText(/em até 30/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Salvar regras do sinal' }))
    await waitFor(() =>
      expect(client.updatePixSignalSettings).toHaveBeenCalledWith(
        'clinic-demo-a',
        expect.objectContaining({
          enabled: true,
          amountKind: 'fixed',
          fixedCents: 5000,
          deadlineSeconds: 1800,
          policyKind: 'credit_next',
          creditWindowMinutes: 1440,
          bookingLeadMinutes: 0,
        }),
        expect.anything(),
      ),
    )
  })

  it('antecedência Outro… com dropdown e máx. 2 dígitos', async () => {
    const client = api()
    render(<RecebimentoScreen tenantId="clinic-demo-a" api={client} generation={1} />)
    await screen.findByRole('button', { name: '30 min' })

    const lead = screen.getByRole('group', { name: 'Antecedência mínima' })
    await userEvent.click(within(lead).getByRole('button', { name: 'Outro…' }))
    const custom = screen.getByLabelText('Antecedência personalizada')
    const num = within(custom).getByLabelText('Número') as HTMLInputElement
    expect(num.maxLength).toBe(2)
    await userEvent.clear(num)
    await userEvent.type(num, '123')
    expect(num.value).toBe('12')

    const unit = within(custom).getByLabelText('Unidade')
    expect(unit.tagName).toBe('SELECT')
    await userEvent.selectOptions(unit, 'h')

    await userEvent.click(screen.getByRole('button', { name: 'Salvar regras do sinal' }))
    await waitFor(() =>
      expect(client.updatePixSignalSettings).toHaveBeenCalledWith(
        'clinic-demo-a',
        expect.objectContaining({ bookingLeadMinutes: 12 * 60 }),
        expect.anything(),
      ),
    )
  })

  it('janela Outro… grava minutos e reflecte na prévia', async () => {
    const client = api()
    render(<RecebimentoScreen tenantId="clinic-demo-a" api={client} generation={1} />)
    await screen.findByRole('button', { name: '24 h antes' })

    const win = screen.getByRole('group', { name: 'Janela' })
    await userEvent.click(within(win).getByRole('button', { name: 'Outro…' }))
    const custom = screen.getByLabelText('Janela personalizada')
    const num = within(custom).getByLabelText('Número') as HTMLInputElement
    await userEvent.clear(num)
    await userEvent.type(num, '36')
    await userEvent.selectOptions(within(custom).getByLabelText('Unidade'), 'h')

    expect(screen.getAllByText(/pelo menos 36/).length).toBeGreaterThanOrEqual(2)

    await userEvent.click(screen.getByRole('button', { name: 'Salvar regras do sinal' }))
    await waitFor(() =>
      expect(client.updatePixSignalSettings).toHaveBeenCalledWith(
        'clinic-demo-a',
        expect.objectContaining({ creditWindowMinutes: 36 * 60 }),
        expect.anything(),
      ),
    )
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
    const body = client.updatePixSignalSettings.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(body).not.toHaveProperty('fixedCents')
    expect(body).not.toHaveProperty('amountKind')
  })

  it('Não devolve preserva janela Outro… (não manda creditWindowMinutes)', async () => {
    const client = api()
    render(<RecebimentoScreen tenantId="clinic-demo-a" api={client} generation={1} />)
    await screen.findByRole('button', { name: '24 h antes' })
    const win = screen.getByRole('group', { name: 'Janela' })
    await userEvent.click(within(win).getByRole('button', { name: 'Outro…' }))
    const custom = screen.getByLabelText('Janela personalizada')
    const num = within(custom).getByLabelText('Número') as HTMLInputElement
    await userEvent.clear(num)
    await userEvent.type(num, '36')
    await userEvent.selectOptions(within(custom).getByLabelText('Unidade'), 'h')
    await userEvent.click(screen.getByRole('button', { name: /Não devolve/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar regras do sinal' }))
    await waitFor(() =>
      expect(client.updatePixSignalSettings).toHaveBeenCalledWith(
        'clinic-demo-a',
        expect.objectContaining({ policyKind: 'keep' }),
        expect.anything(),
      ),
    )
    const body = client.updatePixSignalSettings.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(body).not.toHaveProperty('creditWindowMinutes')
  })
})
