import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AvisosScreen } from './AvisosScreen'

const api = {
  getPushVapidPublicKey: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}
const pwa = {
  getExistingPushSubscription: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}
const fakeSub = {
  endpoint: 'https://push.example/abc',
  toJSON: () => ({
    endpoint: 'https://push.example/abc',
    expirationTime: null,
    keys: { p256dh: 'p', auth: 'a' },
  }),
}

vi.mock('../auth/AuthContext', () => ({ useAuthSession: () => ({ api }) }))
vi.mock('../routes', () => ({ navigatePanel: vi.fn() }))
vi.mock('../sound', () => ({
  isSoundEnabled: () => false,
  setSoundEnabled: vi.fn(),
  playMessageSound: vi.fn(),
}))
vi.mock('../pwa', () => ({
  detectInstallPlatform: () => 'desktop',
  getDeferredInstallPrompt: () => null,
  clearDeferredInstallPrompt: vi.fn(),
  isPushSupported: () => true,
  isStandaloneDisplay: () => false,
  getExistingPushSubscription: (...a: unknown[]) => pwa.getExistingPushSubscription(...a),
  subscribePush: (...a: unknown[]) => pwa.subscribePush(...a),
  unsubscribePush: (...a: unknown[]) => pwa.unsubscribePush(...a),
}))

describe('AvisosScreen — estado ativo', () => {
  beforeEach(() => {
    window.matchMedia ??= ((q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    api.getPushVapidPublicKey.mockReset().mockResolvedValue({ publicKey: 'k', mode: 'x', supported: true })
    api.subscribePush.mockReset().mockResolvedValue({ subscription: { id: '1', endpoint: fakeSub.endpoint, notifyNewConversation: true } })
    api.unsubscribePush.mockReset().mockResolvedValue({ removed: true })
    pwa.getExistingPushSubscription.mockReset().mockResolvedValue(null)
    pwa.subscribePush.mockReset().mockResolvedValue(fakeSub)
    pwa.unsubscribePush.mockReset().mockResolvedValue(true)
  })
  afterEach(cleanup)

  it('sem subscrição mostra «Ativar avisos»', async () => {
    render(<AvisosScreen tenantId="t1" clinicName="Clínica A" />)
    await waitFor(() => expect(pwa.getExistingPushSubscription).toHaveBeenCalled())
    expect(screen.getByText('Ativar avisos')).toBeTruthy()
    expect(screen.queryByText('Desativar avisos')).toBeNull()
  })

  it('com subscrição existente abre já no estado ativo', async () => {
    pwa.getExistingPushSubscription.mockResolvedValue(fakeSub)
    render(<AvisosScreen tenantId="t1" clinicName="Clínica A" />)
    expect(await screen.findByText('Avisos ativos neste aparelho')).toBeTruthy()
    expect(screen.getByText('Guardar alterações')).toBeTruthy()
    expect(screen.getByText('Desativar avisos')).toBeTruthy()
  })

  it('depois de ativar passa ao estado ativo', async () => {
    render(<AvisosScreen tenantId="t1" clinicName="Clínica A" />)
    fireEvent.click(screen.getByText('Ativar avisos'))
    expect(await screen.findByText('Avisos ativos neste aparelho')).toBeTruthy()
    expect(api.subscribePush).toHaveBeenCalledWith('t1', expect.objectContaining({ notifyNewConversation: true }))
    expect(screen.getByText('Guardar alterações')).toBeTruthy()
  })

  it('«Guardar alterações» reenvia as opções atuais', async () => {
    pwa.getExistingPushSubscription.mockResolvedValue(fakeSub)
    render(<AvisosScreen tenantId="t1" clinicName="Clínica A" />)
    await screen.findByText('Guardar alterações')
    fireEvent.click(screen.getByLabelText('Nova conversa'))
    fireEvent.click(screen.getByText('Guardar alterações'))
    await waitFor(() =>
      expect(api.subscribePush).toHaveBeenCalledWith('t1', expect.objectContaining({ notifyNewConversation: false })),
    )
  })

  it('«Desativar avisos» remove no servidor e no aparelho', async () => {
    pwa.getExistingPushSubscription.mockResolvedValue(fakeSub)
    render(<AvisosScreen tenantId="t1" clinicName="Clínica A" />)
    fireEvent.click(await screen.findByText('Desativar avisos'))
    await waitFor(() => expect(screen.getByText('Ativar avisos')).toBeTruthy())
    expect(api.unsubscribePush).toHaveBeenCalledWith('t1', fakeSub.endpoint)
    expect(pwa.unsubscribePush).toHaveBeenCalled()
    expect(screen.queryByText('Avisos ativos neste aparelho')).toBeNull()
  })
})
