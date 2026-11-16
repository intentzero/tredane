import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { AuthProvider, useAuthSession } from '../panel/auth/AuthContext'
import { AuthModeGate } from '../panel/auth/ClerkBridge'
import { ErrorState, LoadingState } from '../panel/states/StatusScreens'
import { AdminNotFound } from './AdminStates'
import { navigatePanelToLogin } from './login'
import { rememberAdminReturn } from './routes'
import './admin.css'

/** Só é pedido depois de o servidor confirmar superadmin (AC-81): quem não tem a flag não baixa as telas. */
const AdminShell = lazy(() => import('./AdminShell'))

type Gate =
  | { phase: 'checking' }
  | { phase: 'allowed' }
  | { phase: 'denied' }
  | { phase: 'error' }

function AdminGate() {
  const { signedIn, authResolved, status, api } = useAuthSession()
  const [gate, setGate] = useState<Gate>({ phase: 'checking' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (status.phase !== 'ready' || !authResolved) return
    if (!signedIn) {
      rememberAdminReturn(window.location.pathname)
      navigatePanelToLogin()
    }
  }, [status.phase, authResolved, signedIn])

  useEffect(() => {
    if (!signedIn || !api) return
    const controller = new AbortController()
    setGate({ phase: 'checking' })
    void api
      .getMe({ signal: controller.signal })
      .then((me) => {
        if (controller.signal.aborted) return
        // Só `true` abre; qualquer outro valor é negado (fail closed).
        setGate({ phase: me.isSuperadmin === true ? 'allowed' : 'denied' })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const code = (err as { code?: string } | null)?.code
        if (code === 'unauthenticated' || code === 'session_expired') {
          rememberAdminReturn(window.location.pathname)
          navigatePanelToLogin()
          return
        }
        setGate({ phase: 'error' })
      })
    return () => controller.abort()
  }, [signedIn, api, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  if (!authResolved || !signedIn || gate.phase === 'checking') {
    return <LoadingState label="Verificando o acesso…" />
  }
  if (gate.phase === 'error') {
    return (
      <ErrorState
        title="Não foi possível verificar o acesso"
        description="Tente de novo em instantes."
        actionLabel="Tentar de novo"
        onAction={retry}
      />
    )
  }
  if (gate.phase === 'denied') return <AdminNotFound />
  return (
    <Suspense fallback={<LoadingState label="Abrindo a Platform Admin…" />}>
      <AdminShell />
    </Suspense>
  )
}

export function AdminApp() {
  return (
    <div className="panel-root admin-root">
      <AuthProvider>
        <AuthModeGate>
          <AdminGate />
        </AuthModeGate>
      </AuthProvider>
    </div>
  )
}
