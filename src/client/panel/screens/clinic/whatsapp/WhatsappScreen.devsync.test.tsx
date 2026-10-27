/**
 * STAGING-ONLY dev-sync no WhatsappScreen (main): só staging + dono; mesma API e
 * mensagens da tela /clinica/whatsapp/dev-sync; esconde em 404 not_found.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi, WhatsappConnection } from '../../../api'

const staging = vi.hoisted(() => ({ value: true }))

vi.mock('./WhatsappDevSyncAction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./WhatsappDevSyncAction')>()
  return { ...actual, isStagingHostname: () => staging.value }
})

import { WhatsappScreen } from './WhatsappScreen'
import { WhatsappDevSyncScreen } from './WhatsappDevSyncScreen'
import {
  DEV_SYNC_BUTTON_LABEL,
  describeDevSyncResult,
} from './WhatsappDevSyncAction'

const actualMod = await vi.importActual<typeof import('./WhatsappDevSyncAction')>(
  './WhatsappDevSyncAction',
)

const connected: WhatsappConnection = {
  status: 'connected',
  phoneNumberId: 'pnid_ficticio',
  wabaId: 'waba_ficticio',
  displayPhone: '+15551820342',
  displayName: null,
  connectedAt: 1_700_000_000_000,
  connectedByClerkUserId: 'system:ops_manual_staging',
  interruptedAt: null,
  interruptReason: null,
  lastInboundAt: null,
  messageTemplates: [],
  history: [],
  metaMode: 'live',
}

function mockApi(sync: { status: number; body: unknown }): PanelApi {
  return {
    getMe: vi.fn(async () => ({ clerkUserId: 'user_ficticio_dono' })),
    getWhatsappConnection: vi.fn(async () => connected),
    devSyncExistingWhatsappBinding: vi.fn(async () => sync),
  } as unknown as PanelApi
}

const okBody = { ok: true, status: 'connected', displayPhone: '+15551820342' }

beforeEach(() => {
  staging.value = true
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderMain(api: PanelApi, isOwner = true) {
  return render(
    <WhatsappScreen
      tenantId="clinic-demo-a"
      api={api}
      generation={1}
      mode="main"
      clinicName="Clínica Demo"
      isOwner={isOwner}
    />,
  )
}

describe('isStagingHostname', () => {
  it('só hostnames começados por staging.', () => {
    expect(actualMod.isStagingHostname('staging.app.tredane.com')).toBe(true)
    expect(actualMod.isStagingHostname('app.tredane.com')).toBe(false)
    expect(actualMod.isStagingHostname('localhost')).toBe(false)
    expect(actualMod.isStagingHostname('x.staging.app.tredane.com')).toBe(false)
  })
})

describe('WhatsappScreen main — dev-sync de staging', () => {
  it('não mostra o autor interno nem IDs técnicos da conexão', async () => {
    const api = mockApi({ status: 200, body: okBody })
    renderMain(api)
    await screen.findByText('WhatsApp conectado')
    const text = document.body.textContent ?? ''
    expect(text).toContain('Conectado pela equipe do Tredane')
    expect(text).not.toContain('system:')
    expect(text).not.toContain('ops_manual')
    expect(text).not.toContain('pnid_')
  })

  it('dono em staging vê o botão, chama a mesma API e mostra o resultado inline', async () => {
    const user = userEvent.setup()
    const api = mockApi({ status: 200, body: okBody })
    renderMain(api)
    await screen.findByText('WhatsApp conectado')
    await user.click(screen.getByRole('button', { name: DEV_SYNC_BUTTON_LABEL }))
    await waitFor(() => {
      expect(api.devSyncExistingWhatsappBinding).toHaveBeenCalledWith(
        'clinic-demo-a',
        expect.objectContaining({ generation: 1 }),
      )
    })
    await screen.findByText(describeDevSyncResult(200, okBody))
    // sucesso recarrega a conexão
    await waitFor(() => expect(api.getWhatsappConnection).toHaveBeenCalledTimes(2))
    // Trocar / Desconectar continuam lá
    expect(screen.getByRole('button', { name: 'Trocar número' })).toBeTruthy()
  })

  it('mostra mensagem de 403 do servidor', async () => {
    const user = userEvent.setup()
    renderMain(mockApi({ status: 403, body: { error: 'forbidden' } }))
    await user.click(await screen.findByRole('button', { name: DEV_SYNC_BUTTON_LABEL }))
    await screen.findByText('Só o dono da clínica pode fazer isto.')
  })

  it('esconde o botão quando a API responde 404 not_found', async () => {
    const user = userEvent.setup()
    renderMain(mockApi({ status: 404, body: { error: 'not_found' } }))
    await user.click(await screen.findByRole('button', { name: DEV_SYNC_BUTTON_LABEL }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: DEV_SYNC_BUTTON_LABEL })).toBeNull()
    })
  })

  it('não aparece para não-donos', async () => {
    renderMain(mockApi({ status: 200, body: okBody }), false)
    await screen.findByText('WhatsApp conectado')
    expect(screen.queryByRole('button', { name: DEV_SYNC_BUTTON_LABEL })).toBeNull()
  })

  it('não aparece fora de staging', async () => {
    staging.value = false
    renderMain(mockApi({ status: 200, body: okBody }))
    await screen.findByText('WhatsApp conectado')
    expect(screen.queryByRole('button', { name: DEV_SYNC_BUTTON_LABEL })).toBeNull()
  })
})

describe('WhatsappDevSyncScreen (partilha a acção)', () => {
  it('continua a mostrar mensagem e HTTP bruto', async () => {
    const user = userEvent.setup()
    const api = mockApi({ status: 200, body: okBody })
    render(<WhatsappDevSyncScreen tenantId="clinic-demo-a" api={api} generation={1} />)
    await user.click(screen.getByRole('button', { name: DEV_SYNC_BUTTON_LABEL }))
    await screen.findByText(describeDevSyncResult(200, okBody))
    expect(screen.getByText(/HTTP 200/)).toBeTruthy()
  })
})
