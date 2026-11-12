import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelApiError, type PanelApi, type TeamSnapshot } from '../../api'
import { EquipeScreen } from './EquipeScreen'

let emitTeamSignal: (() => void) | null = null
vi.mock('../../realtime/InboxRealtime', async (orig) => {
  const mod = await orig<typeof import('../../realtime/InboxRealtime')>()
  return {
    ...mod,
    useInboxRealtime: (cb: (s: unknown[]) => void) => {
      emitTeamSignal = () => cb([{ kind: 'event', event: { eventType: 'invitation.accepted' } }])
    },
  }
})

afterEach(() => {
  cleanup()
  emitTeamSignal = null
})

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
  it('enquanto carrega mostra esqueleto de lista, não spinner órfão', async () => {
    let resolveTeam!: (value: TeamSnapshot) => void
    const pending = new Promise<TeamSnapshot>((resolve) => {
      resolveTeam = resolve
    })
    const api = {
      getTeam: vi.fn(async () => pending),
    } as unknown as PanelApi
    const { container } = render(
      <EquipeScreen
        tenantId="clinic-demo-a"
        api={api}
        generation={1}
        viewerClerkUserId="user_owner"
      />,
    )
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Carregando equipe…').className).toContain('panel-sr-only')
    expect(container.querySelectorAll('.panel-skeleton-row')).toHaveLength(5)
    expect(container.querySelector('.panel-spin')).toBeNull()
    resolveTeam(snap())
    await waitFor(() => expect(screen.getByText('Luciana Moraes (você)')).toBeTruthy())
  })

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
    expect(screen.getAllByText('Responsável').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Atendente').length).toBeGreaterThan(0)
    expect(screen.queryByText('user_owner')).toBeNull()
    expect(screen.queryByText(/recepcionista/i)).toBeNull()
  })

  it('desabilita reenviar durante o cooldown; cancelar pede confirmação (DEC-171)', async () => {
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
    expect(screen.queryByText('Pendente')).toBeNull()
    expect(screen.queryByText(/Até 5 reenvios/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Cancelar…' }))
    expect(api.cancelInvitation).not.toHaveBeenCalled()
    expect(
      screen.getByRole('heading', { name: 'Cancelar o convite de bruno@belapele.example?' }),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Manter convite' }))
    expect(api.cancelInvitation).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancelar…' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar convite' }))
    await waitFor(() =>
      expect(api.cancelInvitation).toHaveBeenCalledWith(
        'clinic-demo-a',
        'inv_1',
        expect.anything(),
      ),
    )
  })

  it('celular: ações do convite numa folha pelo ⋮ (DEC-171)', async () => {
    const user = userEvent.setup()
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({
      matches: q.includes('max-width: 767.98px'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    try {
      const api = mockApi(snap())
      render(
        <EquipeScreen
          tenantId="clinic-demo-a"
          api={api}
          generation={1}
          viewerClerkUserId="user_owner"
        />,
      )
      await waitFor(() => expect(screen.getByText('bruno@belapele.example')).toBeTruthy())
      expect(screen.queryByRole('button', { name: 'Cancelar…' })).toBeNull()
      await user.click(
        screen.getByRole('button', { name: 'Ações do convite para bruno@belapele.example' }),
      )
      expect(screen.getByText(/Até 5 reenvios em 24 h/)).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Cancelar convite…' }))
      expect(
        screen.getByRole('heading', { name: 'Cancelar o convite de bruno@belapele.example?' }),
      ).toBeTruthy()
    } finally {
      window.matchMedia = original
    }
  })

  it('responsável usa o selo neutro e há um bloco com o que cada papel pode fazer (DEC-171)', async () => {
    render(
      <EquipeScreen
        tenantId="clinic-demo-a"
        api={mockApi(snap())}
        generation={1}
        viewerClerkUserId="user_owner"
      />,
    )
    await waitFor(() => expect(screen.getByText('Luciana Moraes (você)')).toBeTruthy())
    const badge = screen.getAllByText('Responsável').find((el) => el.className.includes('panel-badge'))
    expect(badge?.className).toMatch(/panel-badge-new/)
    expect(screen.getByText('O que cada papel pode fazer')).toBeTruthy()
    expect(screen.queryByText('Como responsável, você')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Membros · 2' })).toBeTruthy()
  })

  it('mostra Convidar pessoa no cabeçalho, antes das listas, e o banner Pronto após envio', async () => {
    const user = userEvent.setup()
    const api = mockApi(snap({ invitations: [] }))
    const { container } = render(
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
    const membros = container.querySelector('#equipe-membros-t')?.closest('section')
    const cta = container.querySelector('.equipe-head .equipe-invite-cta')
    expect(membros).toBeTruthy()
    expect(cta).toBeTruthy()
    const position = membros!.compareDocumentPosition(cta!)
    expect(position & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(container.querySelector('.equipe-summary')?.textContent).toBe('2 membros')

    await user.click(screen.getByRole('button', { name: 'Convidar pessoa' }))
    await user.type(screen.getByLabelText('E-mail'), 'nova@clinica.example')
    await user.click(screen.getByRole('button', { name: 'Enviar convite' }))
    await waitFor(() => expect(screen.getByText('Pronto')).toBeTruthy())
    expect(screen.getByText(/Convite enviado por e-mail/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Convidar pessoa' })).toBeTruthy()
  })

  it('não mostra Pronto quando emailSent é false (e-mail não saiu)', async () => {
    const user = userEvent.setup()
    const team = snap({ invitations: [] })
    const api = mockApi(team)
    api.inviteAttendant = vi.fn(async () => ({
      invitation: {
        id: 'inv_fail',
        tenantId: 'clinic-demo-a',
        email: 'falha@clinica.example',
        role: 'attendant',
        status: 'pending',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        lastResentAt: null,
        manageActions: { canResend: true, canCancel: true },
        resend: {
          cooldownMs: 10 * 60_000,
          cooldownRemainingMs: 0,
          windowMs: 24 * 60 * 60 * 1000,
          maxPerWindow: 5,
          usedInWindow: 0,
          remainingInWindow: 5,
        },
      },
      emailSent: false,
    }))
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
    await user.type(screen.getByLabelText('E-mail'), 'falha@clinica.example')
    await user.click(screen.getByRole('button', { name: 'Enviar convite' }))
    await waitFor(() => expect(screen.getByText('Não deu certo')).toBeTruthy())
    expect(screen.queryByText('Pronto')).toBeNull()
    expect(
      screen.getByText(/Convite criado e ficou pendente, mas o e-mail não saiu/),
    ).toBeTruthy()
  })

  it('reenvio sem e-mail não mostra Pronto', async () => {
    const user = userEvent.setup()
    const team = snap({
      invitations: [
        {
          id: 'inv_1',
          tenantId: 'clinic-demo-a',
          email: 'bruno@belapele.example',
          role: 'attendant',
          status: 'pending',
          issuedAt: Date.now() - 60_000,
          expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
          lastResentAt: Date.now() - 20 * 60_000,
          manageActions: { canResend: true, canCancel: true },
          resend: {
            cooldownMs: 10 * 60_000,
            cooldownRemainingMs: 0,
            windowMs: 24 * 60 * 60 * 1000,
            maxPerWindow: 5,
            usedInWindow: 1,
            remainingInWindow: 4,
          },
        },
      ],
    })
    const api = mockApi(team)
    api.resendInvitation = vi.fn(async () => ({
      invitation: team.invitations[0]!,
      emailSent: false,
    }))
    render(
      <EquipeScreen
        tenantId="clinic-demo-a"
        api={api}
        generation={1}
        viewerClerkUserId="user_owner"
      />,
    )
    await waitFor(() => expect(screen.getByText('bruno@belapele.example')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'Reenviar' }))
    await waitFor(() => expect(screen.getByText('Não deu certo')).toBeTruthy())
    expect(screen.queryByText('Pronto')).toBeNull()
    expect(screen.getByText(/e-mail de reenvio não saiu/)).toBeTruthy()
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

describe('EquipeScreen — tempo real invitation.accepted', () => {
  it('ao receber invitation.accepted some o pendente, entra o membro e actualiza contagens', async () => {
    const pending = snap({
      invitations: [
        {
          id: 'inv_laine',
          tenantId: 'clinic-demo-a',
          email: 'lainebsb@hotmail.com',
          role: 'attendant',
          status: 'pending',
          issuedAt: Date.now() - 60_000,
          expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
          lastResentAt: null,
          manageActions: { canResend: true, canCancel: true },
          resend: {
            cooldownMs: 10 * 60_000,
            cooldownRemainingMs: 0,
            windowMs: 24 * 60 * 60 * 1000,
            maxPerWindow: 5,
            usedInWindow: 0,
            remainingInWindow: 5,
          },
        },
      ],
    })
    const afterAccept = snap({
      members: [
        ...pending.members,
        {
          clerkUserId: 'user_laine',
          displayName: 'Laine Silva',
          email: 'lainebsb@hotmail.com',
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
      invitations: [],
    })
    let calls = 0
    const api = mockApi(pending)
    api.getTeam = vi.fn(async () => {
      calls += 1
      return calls === 1 ? pending : afterAccept
    })

    render(
      <EquipeScreen
        tenantId="clinic-demo-a"
        api={api}
        generation={1}
        viewerClerkUserId="user_owner"
      />,
    )
    await waitFor(() => expect(screen.getByText('lainebsb@hotmail.com')).toBeTruthy())
    expect(screen.getByText(/2 membros · 1 convite pendente/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Convites pendentes · 1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar…' })).toBeTruthy()
    expect(screen.queryByText('Laine Silva')).toBeNull()

    expect(emitTeamSignal).toBeTruthy()
    await act(async () => {
      emitTeamSignal!()
    })

    await waitFor(() => expect(screen.getByText('Laine Silva')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Cancelar…' })).toBeNull()
    expect(screen.getByText('Nenhum convite pendente.')).toBeTruthy()
    expect(screen.getByText('3 membros')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Membros · 3/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^Convites pendentes$/ })).toBeTruthy()
    expect(api.getTeam).toHaveBeenCalledTimes(2)
  })
})
