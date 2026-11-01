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
        manageActions: {
          canRevoke: false,
          canInvite: false,
          canPromote: false,
          canDemote: true,
        },
      },
      {
        clerkUserId: 'user_att',
        displayName: 'Ana Souza',
        email: 'ana@belapele.example',
        role: 'attendant',
        status: 'active',
        manageActions: {
          canRevoke: true,
          canInvite: false,
          canPromote: true,
          canDemote: false,
        },
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
    promoteMember: vi.fn(async () => ({
      membership: {
        tenantId: team.tenantId,
        clerkUserId: 'user_att',
        role: 'owner',
        status: 'active',
      },
    })),
    demoteMember: vi.fn(async () => ({
      membership: {
        tenantId: team.tenantId,
        clerkUserId: 'user_other_owner',
        role: 'attendant',
        status: 'active',
      },
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

  it('abre a folha Convidar pessoa e envia com papel', async () => {
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
      expect(screen.getByRole('button', { name: 'Convidar pessoa' })).toBeTruthy(),
    )
    await user.click(screen.getByRole('button', { name: 'Convidar pessoa' }))
    expect(screen.getByLabelText('E-mail')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Responsável' }))
    await user.type(screen.getByLabelText('E-mail'), 'nova@clinica.example')
    await user.click(screen.getByRole('button', { name: 'Enviar convite' }))
    await waitFor(() =>
      expect(api.inviteAttendant).toHaveBeenCalledWith(
        'clinic-demo-a',
        'nova@clinica.example',
        expect.objectContaining({ role: 'owner' }),
      ),
    )
  })
})

describe('EquipeScreen — S2 remoção e DEC-103', () => {
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

    await user.click(screen.getByRole('button', { name: 'Ações para Ana Souza' }))
    await user.click(screen.getByRole('button', { name: 'Remover acesso' }))
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

  it('promove attendant a responsável', async () => {
    const user = userEvent.setup()
    const initial = snap()
    const after: TeamSnapshot = {
      ...initial,
      members: initial.members.map((m) =>
        m.clerkUserId === 'user_att'
          ? {
              ...m,
              role: 'owner',
              manageActions: {
                canRevoke: true,
                canInvite: false,
                canPromote: false,
                canDemote: true,
              },
            }
          : m,
      ),
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
    await user.click(screen.getByRole('button', { name: 'Ações para Ana Souza' }))
    await user.click(screen.getByRole('button', { name: 'Tornar responsável' }))
    await user.click(screen.getByRole('button', { name: 'Tornar responsável' }))
    await waitFor(() =>
      expect(api.promoteMember).toHaveBeenCalledWith(
        'clinic-demo-a',
        'user_att',
        expect.anything(),
      ),
    )
  })

  it('despromove outro responsável e protege o último na UI', async () => {
    const user = userEvent.setup()
    const team = snap({
      members: [
        {
          clerkUserId: 'user_owner',
          displayName: 'Luciana Moraes',
          email: 'luciana@belapele.example',
          role: 'owner',
          status: 'active',
          manageActions: {
            canRevoke: false,
            canInvite: false,
            canPromote: false,
            canDemote: true,
          },
        },
        {
          clerkUserId: 'user_other_owner',
          displayName: 'Paula Owner',
          email: 'paula@belapele.example',
          role: 'owner',
          status: 'active',
          manageActions: {
            canRevoke: true,
            canInvite: false,
            canPromote: false,
            canDemote: true,
          },
        },
      ],
    })
    const api = mockApi(team)

    render(
      <EquipeScreen
        tenantId="clinic-demo-a"
        api={api}
        generation={1}
        viewerClerkUserId="user_owner"
      />,
    )
    await waitFor(() => expect(screen.getByText('Paula Owner')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: 'Ações para Paula Owner' }))
    expect(screen.getByRole('button', { name: 'Tornar atendente' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remover acesso' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Tornar atendente' }))
    await user.click(screen.getByRole('button', { name: 'Tornar atendente' }))
    await waitFor(() =>
      expect(api.demoteMember).toHaveBeenCalledWith(
        'clinic-demo-a',
        'user_other_owner',
        expect.anything(),
      ),
    )
  })

  it('não mostra remoção no único responsável (canRevoke false)', async () => {
    const team = snap({
      members: [
        {
          clerkUserId: 'user_owner',
          displayName: 'Luciana Moraes',
          email: 'luciana@belapele.example',
          role: 'owner',
          status: 'active',
          manageActions: {
            canRevoke: false,
            canInvite: false,
            canPromote: false,
            canDemote: false,
          },
        },
      ],
    })
    const api = mockApi(team)

    render(
      <EquipeScreen
        tenantId="clinic-demo-a"
        api={api}
        generation={1}
        viewerClerkUserId="user_owner"
      />,
    )
    await waitFor(() => expect(screen.getByText('Luciana Moraes (você)')).toBeTruthy())
    expect(
      screen.queryByRole('button', { name: /Ações para Luciana Moraes/ }),
    ).toBeNull()
  })

  it('mostra erro amigável de último owner', async () => {
    const user = userEvent.setup()
    const team = snap({
      members: [
        {
          clerkUserId: 'user_owner',
          displayName: 'Luciana Moraes',
          email: 'luciana@belapele.example',
          role: 'owner',
          status: 'active',
          manageActions: {
            canRevoke: false,
            canInvite: false,
            canPromote: false,
            canDemote: true,
          },
        },
        {
          clerkUserId: 'user_other_owner',
          displayName: 'Paula Owner',
          email: 'paula@belapele.example',
          role: 'owner',
          status: 'active',
          manageActions: {
            canRevoke: true,
            canInvite: false,
            canPromote: false,
            canDemote: true,
          },
        },
      ],
    })
    const api = mockApi(team)
    api.demoteMember = vi.fn(async () => {
      throw new PanelApiError(403, 'permission_denied', 'last_owner_protected')
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
    await user.click(screen.getByRole('button', { name: 'Ações para Paula Owner' }))
    await user.click(screen.getByRole('button', { name: 'Tornar atendente' }))
    await user.click(screen.getByRole('button', { name: 'Tornar atendente' }))
    await waitFor(() =>
      expect(
        screen.getByText(
          'A clínica precisa de pelo menos um responsável. Indique outra pessoa antes de remover ou despromover.',
        ),
      ).toBeTruthy(),
    )
  })
})
