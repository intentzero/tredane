import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PanelApiError, type PanelApi } from '../api'
import { clearPendingInviteToken, writePendingInviteToken } from '../auth/session'

const navigatePanel = vi.fn()
const selectTenant = vi.fn(async () => true)
const reloadTenants = vi.fn()

vi.mock('../routes', () => ({
  navigatePanel: (...args: unknown[]) => navigatePanel(...args),
}))

vi.mock('../auth/ClerkBridge', () => ({
  SignOutButton: () => <button type="button">Sair</button>,
}))

vi.mock('../auth/AuthContext', () => ({
  useAuthSession: () => ({ api: mockApi, signedIn: true }),
}))

vi.mock('../tenant/TenantContext', () => ({
  useTenant: () => ({ selectTenant, reloadTenants }),
}))

vi.mock('../ui/Brand', () => ({
  BrandHorizontal: () => <div>marca</div>,
}))

let mockApi: PanelApi

beforeEach(() => {
  sessionStorage.clear()
  navigatePanel.mockReset()
  selectTenant.mockReset()
  selectTenant.mockResolvedValue(true)
  reloadTenants.mockReset()
  window.history.replaceState(null, '', '/invite/accept')
})

afterEach(cleanup)

async function mount() {
  const { AcceptInviteScreen } = await import('./AcceptInviteScreen')
  return render(<AcceptInviteScreen />)
}

describe('AcceptInviteScreen — S3', () => {
  it('aceita o convite e entra na clínica', async () => {
    writePendingInviteToken('tok_ok_nao_mostrar')
    mockApi = {
      acceptInvitation: vi.fn(async (token: string) => {
        expect(token).toBe('tok_ok_nao_mostrar')
        return {
          invitation: {
            id: 'inv_1',
            tenantId: 'clinic-demo-a',
            email: 'invitee@example.test',
            role: 'attendant',
            status: 'accepted',
            issuedAt: 1,
            expiresAt: 2,
            lastResentAt: null,
            manageActions: { canResend: false, canCancel: false },
            resend: {
              cooldownMs: 0,
              cooldownRemainingMs: 0,
              windowMs: 0,
              maxPerWindow: 5,
              usedInWindow: 0,
              remainingInWindow: 5,
            },
          },
          membership: {
            tenantId: 'clinic-demo-a',
            clerkUserId: 'user_synth_invitee',
            role: 'attendant',
            status: 'active',
          },
        }
      }),
    } as unknown as PanelApi

    await mount()
    expect(screen.getByText('Aceitando o convite…')).toBeTruthy()

    await waitFor(() => {
      expect(mockApi.acceptInvitation).toHaveBeenCalledTimes(1)
      expect(selectTenant).toHaveBeenCalledWith('clinic-demo-a')
      expect(navigatePanel).toHaveBeenCalledWith(
        { kind: 'area', area: 'conversas', tenantId: 'clinic-demo-a', section: 'lista' },
        true,
      )
    })
    expect(sessionStorage.getItem('tredane.pendingInviteToken')).toBeNull()
    expect(screen.queryByText(/tok_ok/i)).toBeNull()
  })

  it('mostra erro claro para convite expirado sem revelar o token', async () => {
    writePendingInviteToken('tok_expirado_secreto_xyz')
    mockApi = {
      acceptInvitation: vi.fn(async () => {
        throw new PanelApiError(409, 'unknown', 'invitation_expired')
      }),
    } as unknown as PanelApi

    await mount()
    await waitFor(() => {
      expect(screen.getByText('Convite expirado')).toBeTruthy()
    })
    expect(screen.getByText(/expirou/i)).toBeTruthy()
    expect(screen.queryByText(/tok_expirado/i)).toBeNull()
    expect(sessionStorage.getItem('tredane.pendingInviteToken')).toBeNull()
  })

  it('mostra e-mail diferente sem revelar o token', async () => {
    writePendingInviteToken('tok_email_errado')
    mockApi = {
      acceptInvitation: vi.fn(async () => {
        throw new PanelApiError(409, 'unknown', 'invitation_email_mismatch')
      }),
    } as unknown as PanelApi

    await mount()
    await waitFor(() => {
      expect(screen.getByText('E-mail diferente')).toBeTruthy()
    })
    expect(screen.getByText(/outro e-mail/i)).toBeTruthy()
    expect(screen.queryByText(/tok_email/i)).toBeNull()
  })

  it('mostra convite cancelado/usado como inválido', async () => {
    writePendingInviteToken('tok_cancelado')
    mockApi = {
      acceptInvitation: vi.fn(async () => {
        throw new PanelApiError(409, 'unknown', 'invitation_token_invalid')
      }),
    } as unknown as PanelApi

    await mount()
    await waitFor(() => {
      expect(screen.getByText('Convite inválido')).toBeTruthy()
    })
    expect(screen.getByText(/cancelado|usado|substituído/i)).toBeTruthy()
  })

  it('pede o link do e-mail quando não há token', async () => {
    clearPendingInviteToken()
    mockApi = {
      acceptInvitation: vi.fn(),
    } as unknown as PanelApi

    await mount()
    await waitFor(() => {
      expect(screen.getByText('Link incompleto')).toBeTruthy()
    })
    expect(mockApi.acceptInvitation).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Ir para clínicas' }))
    expect(navigatePanel).toHaveBeenCalledWith({ kind: 'clinicas' }, true)
  })
})
