/**
 * Equipe (M-18 / S1+S2): membros + convites; convidar / reenviar / cancelar; remover attendant.
 * Aceite do link = AcceptInviteScreen (S3). Sem faixa TEL-10 neste recorte.
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

function canShowRevoke(m: TeamMemberLite, viewerId: string | null): boolean {
  if (!m.manageActions?.canRevoke) return false
  if (m.role === 'owner') return false
  if (viewerId && m.clerkUserId === viewerId) return false
  return m.status === 'active'
}

export function EquipeScreen({ tenantId, api, generation, viewerClerkUserId }: Props) {
  const [snap, setSnap] = useState<TeamSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionOk, setActionOk] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [revoking, setRevoking] = useState<TeamMemberLite | null>(null)

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
        generation,
        expectGeneration: () => generation,
      })
      setInviteOpen(false)
      setInviteEmail('')
      setActionOk('Convite enviado. A pessoa tem 7 dias para aceitar.')
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

  async function onRevoke() {
    if (!revoking) return
    const target = revoking
    const label = target.displayName?.trim() || target.email?.trim() || 'a pessoa'
    setBusyId(`revoke:${target.clerkUserId}`)
    setActionError(null)
    setActionOk(null)
    try {
      await api.revokeMember(tenantId, target.clerkUserId, {
        generation,
        expectGeneration: () => generation,
      })
      setRevoking(null)
      setActionOk(
        `Acesso removido. ${label} não entra mais nesta clínica. Outras clínicas dela não mudam.`,
      )
      await reload()
    } catch (err) {
      setActionError(friendlyError(err, 'Não foi possível remover o acesso.'))
      // Mantém o diálogo aberto só se ainda fizer sentido; erros claros ficam no banner.
      setRevoking(null)
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

  const revokingBusy = revoking != null && busyId === `revoke:${revoking.clerkUserId}`
  const revokingName = revoking
    ? revoking.displayName?.trim() || revoking.email?.trim() || 'esta pessoa'
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
              const showRevoke = canShowRevoke(m, viewerClerkUserId)
              return (
                <li
                  key={m.clerkUserId}
                  className={`equipe-row${showRevoke ? ' equipe-row--actions' : ''}`}
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
                  {showRevoke ? (
                    <Button
                      className="equipe-row-menu"
                      aria-label={`Ações para ${m.displayName?.trim() || memberEmail(m)}: remover acesso`}
                      isDisabled={busyId !== null}
                      onPress={() => {
                        setActionError(null)
                        setActionOk(null)
                        setRevoking(m)
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
          Responsáveis são gerenciados pela equipe do Tredane. Você convida e remove atendentes.
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
                        Atendente · {expiresInLabel(inv.expiresAt, nowMs)}
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
            setInviteOpen(true)
          }}
        >
          Convidar atendente
        </Button>
      </div>

      <ClinicSheet
        isOpen={inviteOpen}
        onOpenChange={(open) => {
          if (busyId === 'invite') return
          setInviteOpen(open)
          if (!open) setInviteEmail('')
        }}
        title="Convidar atendente"
      >
        <p className="panel-subtitle">
          A pessoa recebe um e-mail com link válido por 7 dias. Só atendentes — responsáveis são
          criados pela equipe do Tredane.
        </p>
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
        isOpen={revoking !== null}
        onOpenChange={(open) => {
          if (!open && !revokingBusy) setRevoking(null)
        }}
        isDismissable={!revokingBusy}
        className="panel-overlay panel-choice-overlay"
      >
        <Modal className="panel-choice-modal">
          <Dialog
            className="panel-sheet panel-choice-sheet"
            aria-labelledby="equipe-revoke-title"
            aria-describedby="equipe-revoke-desc"
            role="alertdialog"
          >
            <span className="panel-sheet-handle" aria-hidden="true" />
            <Heading
              slot="title"
              id="equipe-revoke-title"
              className="panel-title panel-choice-title"
            >
              Remover acesso de {revokingName}?
            </Heading>
            <p id="equipe-revoke-desc" className="clinic-footnote">
              A pessoa perde o acesso a esta clínica na hora — inclusive conversas e agenda em tempo
              real. A conta dela no Tredane e o acesso a outras clínicas não mudam. Você pode
              convidar de novo depois.
            </p>
            <div className="clinic-footer-actions">
              <Button
                className="panel-btn panel-btn-ghost"
                isDisabled={revokingBusy}
                onPress={() => setRevoking(null)}
              >
                Cancelar
              </Button>
              <Button
                className="panel-btn panel-btn-danger"
                isDisabled={revokingBusy}
                onPress={() => void onRevoke()}
              >
                {revokingBusy ? 'Removendo…' : 'Remover acesso'}
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  )
}
