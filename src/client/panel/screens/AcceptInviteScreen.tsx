/**
 * Aceite do convite por e-mail (S3 / JRN-13 / AC-22).
 * Link `/invite/accept?token=…` → sessão → POST /api/invitations/accept.
 * O token nunca aparece na tela nem em logs do cliente.
 */
import { useEffect, useState } from 'react'
import { useAuthSession } from '../auth/AuthContext'
import {
  clearPendingInviteToken,
  captureInviteTokenFromLocation,
  readPendingInviteToken,
} from '../auth/session'
import { SignOutButton } from '../auth/ClerkBridge'
import { PanelApiError } from '../api'
import { errorCode, errorDetail, friendlyError } from '../copy/errors'
import { navigatePanel } from '../routes'
import { ErrorState, LoadingState } from '../states/StatusScreens'
import { useTenant } from '../tenant/TenantContext'
import { BrandHorizontal } from '../ui/Brand'

type Phase =
  | { kind: 'working' }
  | { kind: 'missing' }
  | { kind: 'error'; title: string; description: string; detail: string | null; canRetry: boolean }
  | { kind: 'done' }

function titleForCode(code: string): string {
  switch (code) {
    case 'invitation_expired':
      return 'Convite expirado'
    case 'invitation_token_invalid':
    case 'invitation_not_pending':
    case 'invitation_not_found':
      return 'Convite inválido'
    case 'invitation_email_mismatch':
      return 'E-mail diferente'
    case 'invitation_email_unverified':
    case 'invitation_email_missing':
      return 'E-mail não confirmado'
    case 'unauthenticated':
    case 'session_expired':
      return 'Sessão encerrada'
    default:
      return 'Não foi possível aceitar'
  }
}

function isRetryable(code: string, status: number): boolean {
  if (
    code === 'invitation_expired'
    || code === 'invitation_token_invalid'
    || code === 'invitation_not_pending'
    || code === 'invitation_not_found'
    || code === 'invitation_email_mismatch'
    || code === 'invitation_email_unverified'
    || code === 'invitation_email_missing'
    || code === 'token_required'
  ) {
    return false
  }
  return status === 0 || status >= 500 || code === 'invitation_accept_conflict' || code === 'network'
}

export function AcceptInviteScreen() {
  const { api, signedIn } = useAuthSession()
  const { selectTenant, reloadTenants } = useTenant()
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<Phase>({ kind: 'working' })

  useEffect(() => {
    if (!signedIn || !api) return
    let cancelled = false
    setPhase({ kind: 'working' })

    const token = captureInviteTokenFromLocation() ?? readPendingInviteToken()
    if (!token) {
      setPhase({ kind: 'missing' })
      return
    }

    void (async () => {
      try {
        const result = await api.acceptInvitation(token)
        if (cancelled) return
        clearPendingInviteToken()
        reloadTenants()
        const tenantId = result.membership.tenantId
        const ok = await selectTenant(tenantId)
        if (cancelled) return
        setPhase({ kind: 'done' })
        if (ok) {
          navigatePanel(
            { kind: 'area', area: 'conversas', tenantId, section: 'lista' },
            true,
          )
        } else {
          navigatePanel({ kind: 'clinicas' }, true)
        }
      } catch (err) {
        if (cancelled) return
        const code = errorCode(err)
        const status = err instanceof PanelApiError ? err.status : 0
        if (!isRetryable(code, status)) clearPendingInviteToken()
        setPhase({
          kind: 'error',
          title: titleForCode(code),
          description: friendlyError(err, 'Não foi possível aceitar o convite.'),
          detail: errorDetail(err),
          canRetry: isRetryable(code, status),
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [api, signedIn, reloadTenants, selectTenant, attempt])

  if (phase.kind === 'working' || phase.kind === 'done') {
    return <LoadingState label="Aceitando o convite…" />
  }

  const errorAction =
    phase.kind === 'missing'
      ? {
          title: 'Link incompleto',
          description:
            'Abra o convite pelo link do e-mail. Se o problema continuar, peça um novo convite ao responsável.',
          detail: null as string | null,
          canRetry: false,
          note:
            null as string | null,
        }
      : {
          title: phase.title,
          description: phase.description,
          detail: phase.detail,
          canRetry: phase.canRetry,
          note:
            phase.title === 'E-mail diferente'
              ? 'Saia e entre com o e-mail que recebeu o convite.'
              : null,
        }

  return (
    <div className="panel-auth" lang="pt-BR">
      <div className="panel-auth-atmosphere" aria-hidden="true" />
      <div className="panel-auth-stack">
        <div className="panel-auth-hero">
          <div className="panel-auth-brand">
            <BrandHorizontal height={48} />
          </div>
        </div>
        <ErrorState
          title={errorAction.title}
          description={errorAction.description}
          detail={errorAction.detail}
          actionLabel={errorAction.canRetry ? 'Tentar de novo' : 'Ir para clínicas'}
          onAction={() => {
            if (errorAction.canRetry) {
              setAttempt((n) => n + 1)
              return
            }
            navigatePanel({ kind: 'clinicas' }, true)
          }}
        />
        {errorAction.note ? <p className="panel-auth-note">{errorAction.note}</p> : null}
        <div className="panel-auth-foot">
          <SignOutButton />
        </div>
      </div>
    </div>
  )
}
