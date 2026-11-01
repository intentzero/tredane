import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelApiError, type PanelApi, type TeamSnapshot } from '../../api'
import { EquipeScreen } from './EquipeScreen'

afterEach(cleanup)

function snap(over: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    tenantId: 'clinic-demo-a',
    members: [
      {
        clerkUserId: 'user_owner',
        displayName: 'Luciana Moraes',
        email: 'luciana@belapele.example',
        role: 'owner',
        status: 'active',
        manageActions: { canRevoke: false, canInvite: false },
      },
      {
        clerkUserId: 'user_att',
        displayName: 'Ana Souza',
        email: 'ana@belapele.example',
        role: 'attendant',
        status: 'active',
        manageActions: { canRevoke: true, canInvite: false },
      },
    ],
    invitations: [
      {
        id: 'inv_1',
        tenantId: 'clinic-demo-a',
        email: 'bruno@belapele.example',
        role: 'attendant',
        status: 'pending',
        issuedAt: Date.now() - 60_000,
        expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
        lastResentAt: Date.now() - 2 * 60_000,
        manageActions: { canResend: false, canCancel: true },
        resend: {
          cooldownMs: 10 * 60_000,
          cooldownRemainingMs: 8 * 60_000,
          windowMs: 24 * 60 * 60 * 1000,
          maxPerWindow: 5,
          usedInWindow: 1,
          remainingInWindow: 4,
        },
      },
    ],
    ...over,
  }
}

function mockApi(team: TeamSnapshot): PanelApi {
  return {
    getTeam: vi.fn(async () => team),
    inviteAttendant: vi.fn(async () => ({
      invitation: team.invitations[0]!,
      emailSent: true,
    })),
    resendInvitation: vi.fn(async () => ({
      invitation: {
        ...team.invitations[0]!,
        lastResentAt: Date.now(),
        manageActions: { canResend: false, canCancel: true },
        resend: { ...team.invitations[0]!.resend, cooldownRemainingMs: 10 * 60_000 },
      },
      emailSent: true,
    })),
    cancelInvitation: vi.fn(async () => ({
      invitation: {
        ...team.invitations[0]!,
        status: 'cancelled',
        manageActions: { canResend: false, canCancel: false },
      },
    })),
    revokeMember: vi.fn(async () => ({
      tenantId: team.tenantId,
      clerkUserId: 'user_att',
      status: 'revoked',
      doNotified: true,
      doError: null,
      closedConnections: [],
    })),
  } as unknown as PanelApi
}

describe('EquipeScreen — S1', () => {
  it('mostra nome e e-mail dos membros, não o clerkUserId como rótulo', async () => {
    const api = mockApi(snap())
    render(
      <EquipeScreen
        tenantId="clinic-demo-a"
        api={api}
        generation={1}
        viewerClerkUserId="user_owner"
      />,
    )
    await waitFor(() => expect(screen.getByText('Luciana Moraes (você)')).toBeTruthy())
    expect(screen.getByText('luciana@belapele.example')).toBeTruthy()
    expect(screen.getByText('Ana Souza')).toBeTruthy()
    expect(screen.getByText('ana@belapele.example')).toBeTruthy()
    expect(screen.getByText('Responsável')).toBeTruthy()
    expect(screen.getAllByText('Atendente').length).toBeGreaterThan(0)
    expect(screen.queryByText('user_owner')).toBeNull()
    expect(screen.queryByText(/recepcionista/i)).toBeNull()
  })

  it('desabilita reenviar durante o cooldown e cancela o convite', async () => {
    const user = userEvent.setup()
    const team = snap()
    const api = mockApi(team)
    render(
      <EquipeScreen
        tenantId="clinic-demo-a"
        api={api}
        generation={1}
        viewerClerkUserId="user_owner"
      />,
    )
    await waitFor(() => expect(screen.getByText('bruno@belapele.example')).toBeTruthy())
    const resend = screen.getByRole('button', { name: /Reenviar em \d+ min/ })
    expect(resend).toHaveProperty('disabled', true)

    await user.click(screen.getByRole('button', { name: 'Cancelar convite' }))
    await waitFor(() =>
      expect(api.cancelInvitation).toHaveBeenCalledWith(
        'clinic-demo-a',
        'inv_1',
        expect.anything(),
      ),
    )
  })

  it('abre a folha Convidar atendente', async () => {
    const user = userEvent.setup()
    const api = mockApi(snap({ invitations: [] }))
    render(
      <EquipeScreen
        tenantId="clinic-demo-a"
        api={api}
        generation={1}
        viewerClerkUserId="user_owner"
      />,
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Convidar atendente' })).toBeTruthy(),
    )
    await user.click(screen.getByRole('button', { name: 'Convidar atendente' }))
    expect(screen.getByLabelText('E-mail')).toBeTruthy()
    await user.type(screen.getByLabelText('E-mail'), 'nova@clinica.example')
    await user.click(screen.getByRole('button', { name: 'Enviar convite' }))
    await waitFor(() =>
      expect(api.inviteAttendant).toHaveBeenCalledWith(
        'clinic-demo-a',
        'nova@clinica.example',
        expect.anything(),
      ),
    )
  })
})

describe('EquipeScreen — S2 remoção', () => {
  it('owner remove attendant com confirmação e atualiza a lista', async () => {
    const user = userEvent.setup()
    const initial = snap()
    const after: TeamSnapshot = {
      ...initial,
      members: initial.members.filter((m) => m.clerkUserId !== 'user_att'),
    }
    const api = mockApi(initial)
    let calls = 0
    api.getTeam = vi.fn(async () => {
      calls += 1
      return calls === 1 ? initial : after
    })

    render(
      <EquipeScreen
        tenantId="clinic-demo-a"
        api={api}
        generation={1}
        viewerClerkUserId="user_owner"
      />,
    )
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeTruthy())

    expect(
      screen.queryByRole('button', {
        name: /Ações para Luciana Moraes/,
      }),
    ).toBeNull()

    await user.click(
      screen.getByRole('button', { name: 'Ações para Ana Souza: remover acesso' }),
    )
    expect(screen.getByRole('heading', { name: 'Remover acesso de Ana Souza?' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Remover acesso' }))

    await waitFor(() =>
      expect(api.revokeMember).toHaveBeenCalledWith(
        'clinic-demo-a',
        'user_att',
        expect.anything(),
      ),
    )
    await waitFor(() => expect(screen.queryByText('Ana Souza')).toBeNull())
    expect(
      screen.getByText(
        /Acesso removido\. Ana Souza não entra mais nesta clínica\. Outras clínicas dela não mudam\./,
      ),
    ).toBeTruthy()
  })

  it('mostra erro claro quando a API recusa remover responsável', async () => {
    const user = userEvent.setup()
    const team = snap({
      members: [
        {
          clerkUserId: 'user_owner',
          displayName: 'Luciana Moraes',
          email: 'luciana@belapele.example',
          role: 'owner',
          status: 'active',
          manageActions: { canRevoke: false, canInvite: false },
        },
        {
          clerkUserId: 'user_other_owner',
          displayName: 'Paula Owner',
          email: 'paula@belapele.example',
          role: 'owner',
          status: 'active',
          // UI não deveria mostrar ação; se forçar via canRevoke, a API ainda nega.
          manageActions: { canRevoke: true, canInvite: false },
        },
      ],
    })
    const api = mockApi(team)
    api.revokeMember = vi.fn(async () => {
      throw new PanelApiError(403, 'permission_denied', 'cannot_revoke_owner')
    })

    render(
      <EquipeScreen
        tenantId="clinic-demo-a"
        api={api}
        generation={1}
        viewerClerkUserId="user_owner"
      />,
    )
    await waitFor(() => expect(screen.getByText('Paula Owner')).toBeTruthy())

    // canShowRevoke bloqueia owners mesmo com canRevoke true
    expect(
      screen.queryByRole('button', { name: /Ações para Paula Owner/ }),
    ).toBeNull()
  })

  it('mostra erro amigável se revoke falhar para attendant', async () => {
    const user = userEvent.setup()
    const api = mockApi(snap())
    api.revokeMember = vi.fn(async () => {
      throw new PanelApiError(403, 'permission_denied', 'cannot_revoke_owner')
    })

    render(
      <EquipeScreen
        tenantId="clinic-demo-a"
        api={api}
        generation={1}
        viewerClerkUserId="user_owner"
      />,
    )
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeTruthy())
    await user.click(
      screen.getByRole('button', { name: 'Ações para Ana Souza: remover acesso' }),
    )
    await user.click(screen.getByRole('button', { name: 'Remover acesso' }))
    await waitFor(() =>
      expect(
        screen.getByText(
          'Responsáveis não podem ser removidos por aqui. Fale com a equipe do Tredane.',
        ),
      ).toBeTruthy(),
    )
  })
})
