/**
 * Equipe (M-18 / S1–S3 + DEC-103): membros + convites; convidar attendant/owner;
 * promover / despromover / remover (último owner protegido).
 */
import { MoreVertical } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Dialog,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  Radio,
  RadioGroup,
  TextField,
} from 'react-aria-components'
import type { PanelApi, TeamInvitation, TeamMemberLite, TeamSnapshot } from '../../api'
import { PanelApiError } from '../../api'
import { friendlyError } from '../../copy/errors'
import { navigatePanel } from '../../routes'
import { Badge } from '../../states/Badge'
import { Banner } from '../../states/Banner'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import { ClinicSheet } from './ClinicSheet'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  viewerClerkUserId: string | null
}

type MemberAction = 'promote' | 'demote' | 'revoke'

function roleLabel(role: string): string {
  return role === 'owner' ? 'Responsável' : 'Atendente'
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase()
}

function memberDisplayName(m: TeamMemberLite, viewerId: string | null): string {
  const base = m.displayName?.trim() || 'Sem nome'
  if (viewerId && m.clerkUserId === viewerId) return `${base} (você)`
  return base
}

function memberEmail(m: TeamMemberLite): string {
  return m.email?.trim() || 'Sem e-mail'
}

function expiresInLabel(expiresAt: number, nowMs: number): string {
  const ms = expiresAt - nowMs
  if (ms <= 0) return 'expirado'
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000))
  if (days <= 1) {
    const hours = Math.max(1, Math.ceil(ms / (60 * 60 * 1000)))
    return hours === 1 ? 'expira em 1 hora' : `expira em ${hours} horas`
  }
  return days === 1 ? 'expira em 1 dia' : `expira em ${days} dias`
}

function cooldownLeftMs(inv: TeamInvitation, nowMs: number): number {
  if (inv.lastResentAt != null) {
    return Math.max(0, inv.resend.cooldownMs - (nowMs - inv.lastResentAt))
  }
  return Math.max(0, inv.resend.cooldownRemainingMs)
}

function resendButtonLabel(inv: TeamInvitation, nowMs: number): string {
  const left = cooldownLeftMs(inv, nowMs)
  if (left > 0) {
    const mins = Math.max(1, Math.ceil(left / 60_000))
    return mins === 1 ? 'Reenviar em 1 min' : `Reenviar em ${mins} min`
  }
  if (inv.resend.remainingInWindow <= 0) return 'Limite de reenvios'
  return 'Reenviar'
}

function canResendNow(inv: TeamInvitation, nowMs: number): boolean {
  if (!inv.manageActions.canCancel) return false
  if (inv.resend.remainingInWindow <= 0) return false
  return cooldownLeftMs(inv, nowMs) === 0
}

function canShowPromote(m: TeamMemberLite, viewerId: string | null): boolean {
  if (!m.manageActions?.canPromote) return false
  if (m.role !== 'attendant') return false
  if (viewerId && m.clerkUserId === viewerId) return false
  return m.status === 'active'
}

function canShowDemote(m: TeamMemberLite): boolean {
  if (!m.manageActions?.canDemote) return false
  if (m.role !== 'owner') return false
  return m.status === 'active'
}

function canShowRevoke(m: TeamMemberLite, viewerId: string | null): boolean {
  if (!m.manageActions?.canRevoke) return false
  if (viewerId && m.clerkUserId === viewerId) return false
  return m.status === 'active'
}

function hasMemberMenu(m: TeamMemberLite, viewerId: string | null): boolean {
  return canShowPromote(m, viewerId) || canShowDemote(m) || canShowRevoke(m, viewerId)
}

export function EquipeScreen({ tenantId, api, generation, viewerClerkUserId }: Props) {
  const [snap, setSnap] = useState<TeamSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'attendant' | 'owner'>('attendant')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionOk, setActionOk] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [menuMember, setMenuMember] = useState<TeamMemberLite | null>(null)
  const [pendingAction, setPendingAction] = useState<{
    member: TeamMemberLite
    action: MemberAction
  } | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await api.getTeam(tenantId, {
        generation,
        expectGeneration: () => generation,
      })
      setSnap(next)
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(friendlyError(err, 'Não foi possível carregar a equipe.'))
    } finally {
      setLoading(false)
    }
  }, [api, tenantId, generation])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])

  const members = useMemo(() => {
    const list = (snap?.members ?? []).filter((m) => m.status === 'active')
    return [...list].sort((a, b) => {
      if (a.role !== b.role) return a.role === 'owner' ? -1 : 1
      return memberDisplayName(a, viewerClerkUserId).localeCompare(
        memberDisplayName(b, viewerClerkUserId),
        'pt-BR',
      )
    })
  }, [snap, viewerClerkUserId])

  const invitations = useMemo(() => {
    const list = (snap?.invitations ?? []).filter((i) => i.status === 'pending')
    return [...list].sort((a, b) => a.expiresAt - b.expiresAt)
  }, [snap])

  async function onInvite() {
    const email = inviteEmail.trim()
    if (!email) {
      setActionError('Informe o e-mail da pessoa.')
      return
    }
    setBusyId('invite')
    setActionError(null)
    setActionOk(null)
    try {
      await api.inviteAttendant(tenantId, email, {
        role: inviteRole,
        generation,
        expectGeneration: () => generation,
      })
      setInviteOpen(false)
      setInviteEmail('')
      setInviteRole('attendant')
      setActionOk(
        inviteRole === 'owner'
          ? 'Convite de responsável enviado. A pessoa tem 7 dias para aceitar.'
          : 'Convite enviado. A pessoa tem 7 dias para aceitar.',
      )
      await reload()
    } catch (err) {
      setActionError(friendlyError(err, 'Não foi possível enviar o convite.'))
    } finally {
      setBusyId(null)
    }
  }

  async function onResend(inv: TeamInvitation) {
    setBusyId(inv.id)
    setActionError(null)
    setActionOk(null)
    try {
      await api.resendInvitation(tenantId, inv.id, {
        generation,
        expectGeneration: () => generation,
      })
      setActionOk('Convite reenviado. O link anterior deixa de valer.')
      await reload()
    } catch (err) {
      setActionError(friendlyError(err, 'Não foi possível reenviar o convite.'))
      await reload()
    } finally {
      setBusyId(null)
    }
  }

  async function onCancel(inv: TeamInvitation) {
    setBusyId(`cancel:${inv.id}`)
    setActionError(null)
    setActionOk(null)
    try {
      await api.cancelInvitation(tenantId, inv.id, {
        generation,
        expectGeneration: () => generation,
      })
      setActionOk('Convite cancelado. O link deixa de funcionar.')
      await reload()
    } catch (err) {
      setActionError(friendlyError(err, 'Não foi possível cancelar o convite.'))
    } finally {
      setBusyId(null)
    }
  }

  async function onConfirmAction() {
    if (!pendingAction) return
    const { member, action } = pendingAction
    const label = member.displayName?.trim() || member.email?.trim() || 'a pessoa'
    setBusyId(`${action}:${member.clerkUserId}`)
    setActionError(null)
    setActionOk(null)
    try {
      if (action === 'promote') {
        await api.promoteMember(tenantId, member.clerkUserId, {
          generation,
          expectGeneration: () => generation,
        })
        setActionOk(`${label} agora é responsável nesta clínica.`)
      } else if (action === 'demote') {
        await api.demoteMember(tenantId, member.clerkUserId, {
          generation,
          expectGeneration: () => generation,
        })
        setActionOk(`${label} passou a ser atendente nesta clínica.`)
      } else {
        await api.revokeMember(tenantId, member.clerkUserId, {
          generation,
          expectGeneration: () => generation,
        })
        setActionOk(
          `Acesso removido. ${label} não entra mais nesta clínica. Outras clínicas dela não mudam.`,
        )
      }
      setPendingAction(null)
      await reload()
    } catch (err) {
      setActionError(
        friendlyError(
          err,
          action === 'promote'
            ? 'Não foi possível promover a responsável.'
            : action === 'demote'
              ? 'Não foi possível despromover.'
              : 'Não foi possível remover o acesso.',
        ),
      )
      setPendingAction(null)
      await reload()
    } finally {
      setBusyId(null)
    }
  }

  if (loading && !snap) {
    return <LoadingState label="Carregando equipe…" />
  }
  if (error && !snap) {
    return (
      <ErrorState
        title="Não foi possível carregar a equipe"
        description={error}
        actionLabel="Tentar de novo"
        onAction={() => void reload()}
      />
    )
  }
  if (!snap) return <LoadingState label="Carregando equipe…" />

  const confirmBusy =
    pendingAction != null && busyId === `${pendingAction.action}:${pendingAction.member.clerkUserId}`
  const confirmName = pendingAction
    ? pendingAction.member.displayName?.trim()
      || pendingAction.member.email?.trim()
      || 'esta pessoa'
    : ''

  return (
    <div className="clinic-stack equipe-screen">
      <div className="clinic-toolbar">
        <Button
          className="panel-btn panel-btn-ghost"
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'hub' })
          }
        >
          Voltar
        </Button>
      </div>

      <h2 className="panel-title">Equipe</h2>

      {actionError ? (
        <Banner tone="error" title="Não deu certo">
          <p>{actionError}</p>
        </Banner>
      ) : null}
      {actionOk ? (
        <Banner tone="ok" title="Pronto">
          <p>{actionOk}</p>
        </Banner>
      ) : null}

      <section className="equipe-section" aria-labelledby="equipe-membros-t">
        <h3 id="equipe-membros-t" className="panel-legend">
          Membros
        </h3>
        {members.length === 0 ? (
          <p className="panel-subtitle">Nenhum membro ativo nesta clínica.</p>
        ) : (
          <ul className="equipe-list">
            {members.map((m) => {
              const name = memberDisplayName(m, viewerClerkUserId)
              const showMenu = hasMemberMenu(m, viewerClerkUserId)
              return (
                <li
                  key={m.clerkUserId}
                  className={`equipe-row${showMenu ? ' equipe-row--actions' : ''}`}
                >
                  <span
                    className={`equipe-avatar${m.role === 'owner' ? ' equipe-avatar--owner' : ''}`}
                    aria-hidden
                  >
                    {initials(m.displayName?.trim() || '?')}
                  </span>
                  <span className="equipe-copy">
                    <strong>{name}</strong>
                    <span>{memberEmail(m)}</span>
                    <Badge tone={m.role === 'owner' ? 'ai' : 'closed'}>{roleLabel(m.role)}</Badge>
                  </span>
                  {showMenu ? (
                    <Button
                      className="equipe-row-menu"
                      aria-label={`Ações para ${m.displayName?.trim() || memberEmail(m)}`}
                      isDisabled={busyId !== null}
                      onPress={() => {
                        setActionError(null)
                        setActionOk(null)
                        setMenuMember(m)
                      }}
                    >
                      <MoreVertical aria-hidden size={20} strokeWidth={2} />
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        <p className="clinic-footnote">
          Você convida atendentes e responsáveis, promove, despromove e remove acesso. A clínica
          precisa ficar com pelo menos um responsável.
        </p>
      </section>

      <section className="equipe-section" aria-labelledby="equipe-convites-t">
        <h3 id="equipe-convites-t" className="panel-legend">
          Convites pendentes
        </h3>
        {invitations.length === 0 ? (
          <p className="panel-subtitle">Nenhum convite pendente.</p>
        ) : (
          <ul className="equipe-invite-list">
            {invitations.map((inv) => {
              const resendEnabled = canResendNow(inv, nowMs) && busyId !== inv.id
              return (
                <li key={inv.id} className="equipe-invite">
                  <div className="equipe-invite-head">
                    <span className="equipe-copy">
                      <strong>{inv.email}</strong>
                      <span>
                        {roleLabel(inv.role)} · {expiresInLabel(inv.expiresAt, nowMs)}
                      </span>
                    </span>
                    <Badge tone="wait">Pendente</Badge>
                  </div>
                  <div className="equipe-invite-actions">
                    <Button
                      className="panel-btn panel-btn-secondary equipe-action-btn"
                      isDisabled={!resendEnabled || busyId !== null}
                      onPress={() => void onResend(inv)}
                    >
                      {resendButtonLabel(inv, nowMs)}
                    </Button>
                    <Button
                      className="panel-btn panel-btn-ghost equipe-action-btn equipe-cancel"
                      isDisabled={!inv.manageActions.canCancel || busyId !== null}
                      onPress={() => void onCancel(inv)}
                    >
                      Cancelar convite
                    </Button>
                  </div>
                  <p className="clinic-footnote">
                    Reenviar gera um novo link e invalida o anterior. Até 5 reenvios em 24 h, com 10
                    min entre eles.
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="equipe-cta">
        <Button
          className="panel-btn panel-btn-primary"
          onPress={() => {
            setActionError(null)
            setInviteRole('attendant')
            setInviteOpen(true)
          }}
        >
          Convidar pessoa
        </Button>
      </div>

      <ClinicSheet
        isOpen={inviteOpen}
        onOpenChange={(open) => {
          if (busyId === 'invite') return
          setInviteOpen(open)
          if (!open) {
            setInviteEmail('')
            setInviteRole('attendant')
          }
        }}
        title="Convidar pessoa"
      >
        <p className="panel-subtitle">
          A pessoa recebe um e-mail com link válido por 7 dias. Escolha se entra como atendente ou
          responsável.
        </p>
        <RadioGroup
          className="clinic-field"
          value={inviteRole}
          onChange={(v) => setInviteRole(v === 'owner' ? 'owner' : 'attendant')}
          aria-label="Papel do convite"
        >
          <Label>Papel</Label>
          <div className="vc-seg">
            <Radio value="attendant" className="vc-seg-item">
              Atendente
            </Radio>
            <Radio value="owner" className="vc-seg-item">
              Responsável
            </Radio>
          </div>
        </RadioGroup>
        <TextField className="clinic-field" value={inviteEmail} onChange={setInviteEmail} type="email">
          <Label>E-mail</Label>
          <Input placeholder="nome@clinica.example" autoComplete="email" inputMode="email" />
        </TextField>
        {actionError && inviteOpen ? (
          <p className="clinic-form-error" role="alert">
            {actionError}
          </p>
        ) : null}
        <div className="clinic-footer-actions">
          <Button
            className="panel-btn panel-btn-secondary"
            isDisabled={busyId === 'invite'}
            onPress={() => setInviteOpen(false)}
          >
            Cancelar
          </Button>
          <Button
            className="panel-btn panel-btn-primary"
            isDisabled={busyId === 'invite' || !inviteEmail.trim()}
            onPress={() => void onInvite()}
          >
            {busyId === 'invite' ? 'Enviando…' : 'Enviar convite'}
          </Button>
        </div>
      </ClinicSheet>

      <ModalOverlay
        isOpen={menuMember !== null}
        onOpenChange={(open) => {
          if (!open) setMenuMember(null)
        }}
        isDismissable
        className="panel-overlay panel-choice-overlay"
      >
        <Modal className="panel-choice-modal">
          <Dialog
            className="panel-sheet panel-choice-sheet"
            aria-labelledby="equipe-actions-title"
          >
            <span className="panel-sheet-handle" aria-hidden="true" />
            <Heading
              slot="title"
              id="equipe-actions-title"
              className="panel-title panel-choice-title"
            >
              {menuMember
                ? menuMember.displayName?.trim() || menuMember.email?.trim() || 'Membro'
                : 'Ações'}
            </Heading>
            <div className="clinic-footer-actions" style={{ flexDirection: 'column', gap: 8 }}>
              {menuMember && canShowPromote(menuMember, viewerClerkUserId) ? (
                <Button
                  className="panel-btn panel-btn-secondary"
                  onPress={() => {
                    setPendingAction({ member: menuMember, action: 'promote' })
                    setMenuMember(null)
                  }}
                >
                  Tornar responsável
                </Button>
              ) : null}
              {menuMember && canShowDemote(menuMember) ? (
                <Button
                  className="panel-btn panel-btn-secondary"
                  onPress={() => {
                    setPendingAction({ member: menuMember, action: 'demote' })
                    setMenuMember(null)
                  }}
                >
                  Tornar atendente
                </Button>
              ) : null}
              {menuMember && canShowRevoke(menuMember, viewerClerkUserId) ? (
                <Button
                  className="panel-btn panel-btn-danger"
                  onPress={() => {
                    setPendingAction({ member: menuMember, action: 'revoke' })
                    setMenuMember(null)
                  }}
                >
                  Remover acesso
                </Button>
              ) : null}
              <Button className="panel-btn panel-btn-ghost" onPress={() => setMenuMember(null)}>
                Fechar
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>

      <ModalOverlay
        isOpen={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open && !confirmBusy) setPendingAction(null)
        }}
        isDismissable={!confirmBusy}
        className="panel-overlay panel-choice-overlay"
      >
        <Modal className="panel-choice-modal">
          <Dialog
            className="panel-sheet panel-choice-sheet"
            aria-labelledby="equipe-confirm-title"
            aria-describedby="equipe-confirm-desc"
            role="alertdialog"
          >
            <span className="panel-sheet-handle" aria-hidden="true" />
            <Heading
              slot="title"
              id="equipe-confirm-title"
              className="panel-title panel-choice-title"
            >
              {pendingAction?.action === 'promote'
                ? `Tornar ${confirmName} responsável?`
                : pendingAction?.action === 'demote'
                  ? `Tornar ${confirmName} atendente?`
                  : `Remover acesso de ${confirmName}?`}
            </Heading>
            <p id="equipe-confirm-desc" className="clinic-footnote">
              {pendingAction?.action === 'promote'
                ? 'A pessoa passa a configurar a clínica, convidar equipe e gerir responsáveis.'
                : pendingAction?.action === 'demote'
                  ? 'A pessoa deixa de ser responsável e fica só como atendente. A clínica precisa manter pelo menos um responsável.'
                  : 'A pessoa perde o acesso a esta clínica na hora — inclusive conversas e agenda em tempo real. A conta dela no Tredane e o acesso a outras clínicas não mudam. Você pode convidar de novo depois.'}
            </p>
            <div className="clinic-footer-actions">
              <Button
                className="panel-btn panel-btn-ghost"
                isDisabled={confirmBusy}
                onPress={() => setPendingAction(null)}
              >
                Cancelar
              </Button>
              <Button
                className={
                  pendingAction?.action === 'revoke'
                    ? 'panel-btn panel-btn-danger'
                    : 'panel-btn panel-btn-primary'
                }
                isDisabled={confirmBusy}
                onPress={() => void onConfirmAction()}
              >
                {confirmBusy
                  ? pendingAction?.action === 'revoke'
                    ? 'Removendo…'
                    : 'Salvando…'
                  : pendingAction?.action === 'promote'
                    ? 'Tornar responsável'
                    : pendingAction?.action === 'demote'
                      ? 'Tornar atendente'
                      : 'Remover acesso'}
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  )
}
