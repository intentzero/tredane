import { useEffect, useState } from 'react'
import { AuthProvider, useAuthSession } from './auth/AuthContext'
import { AuthModeGate, LoginScreen } from './auth/ClerkBridge'
import { ClinicSelector } from './screens/ClinicSelector'
import { ClinicArea } from './screens/clinic/ClinicArea'
import { ConversasArea } from './screens/inbox/ConversasArea'
import { AcompanhamentoArea } from './screens/acompanhamento/AcompanhamentoArea'
import { AgendaArea } from './screens/agenda/AgendaArea'
import { AvisosScreen } from './screens/AvisosScreen'
import { PanelShell } from './shell/PanelShell'
import { ErrorState, LoadingState } from './states/StatusScreens'
import { TenantProvider, useTenant } from './tenant/TenantContext'
import { captureInstallPrompt, registerServiceWorker } from './pwa'
import {
  navigatePanel,
  resolvePanelRoute,
  type PanelRoute,
} from './routes'

function usePanelPath(): PanelRoute | null {
  const [route, setRoute] = useState<PanelRoute | null>(() =>
    resolvePanelRoute(window.location.pathname),
  )
  useEffect(() => {
    const onPop = () => setRoute(resolvePanelRoute(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return route
}

function PanelRouter() {
  const route = usePanelPath()
  const { signedIn, status, authResolved } = useAuthSession()
  const { selectTenant, active } = useTenant()
  // Clerk que não responde (sem rede, script bloqueado) não pode deixar a tela em «Abrindo…» para sempre.
  const [authSlow, setAuthSlow] = useState(false)
  useEffect(() => {
    if (authResolved) {
      setAuthSlow(false)
      return
    }
    const id = window.setTimeout(() => setAuthSlow(true), 10_000)
    return () => window.clearTimeout(id)
  }, [authResolved])

  useEffect(() => {
    if (status.phase !== 'ready') return
    if (!authResolved) return
    if (!route) return

    if (!signedIn && route.kind !== 'entrar') {
      navigatePanel({ kind: 'entrar' }, true)
      return
    }
    if (signedIn && route.kind === 'entrar') {
      navigatePanel({ kind: 'clinicas' }, true)
    }
  }, [signedIn, route, status.phase, authResolved])

  useEffect(() => {
    if (!route || route.kind !== 'area') return
    if (!signedIn) return
    if (active.phase === 'ready' && active.context.tenantId === route.tenantId) return
    if (active.phase === 'switching' && active.tenantId === route.tenantId) return
    if (active.phase === 'forbidden' && active.tenantId === route.tenantId) return
    void selectTenant(route.tenantId)
  }, [route, signedIn, active, selectTenant])

  if (!route) {
    return (
      <LoadingState label="Rota do painel inválida. Use /entrar." />
    )
  }

  if (route.kind === 'entrar') {
    return <LoginScreen />
  }

  if (!authResolved) {
    if (authSlow) {
      return (
        <ErrorState
          title="Não foi possível abrir o painel"
          description="Verifique a internet e tente de novo."
          actionLabel="Tentar de novo"
          onAction={() => window.location.reload()}
        />
      )
    }
    return <LoadingState label="Abrindo o painel…" />
  }

  if (!signedIn) {
    return <LoadingState label="A redirecionar para entrar…" />
  }

  if (route.kind === 'clinicas') {
    return <ClinicSelector />
  }

  if (route.area === 'avisos') {
    const clinicName =
      active.phase === 'ready' ? active.context.name : 'clínica'
    return (
      <PanelShell area="avisos" tenantId={route.tenantId} hideNav>
        <AvisosScreen tenantId={route.tenantId} clinicName={clinicName} />
      </PanelShell>
    )
  }

  return (
    <PanelShell
      area={route.area}
      tenantId={route.tenantId}
      immersiveOnPhone={route.area === 'conversas' && route.section === 'thread'}
    >
      {route.area === 'clinica' ? (
        <ClinicArea
          tenantId={route.tenantId}
          section={route.section}
          entityId={route.entityId}
        />
      ) : route.area === 'conversas' ? (
        <ConversasArea
          tenantId={route.tenantId}
          section={route.section}
          conversationId={route.conversationId}
          contactId={route.contactId}
        />
      ) : route.area === 'acompanhamento' ? (
        <AcompanhamentoArea
          tenantId={route.tenantId}
          section={route.section}
          opportunityId={route.opportunityId}
        />
      ) : (
        <AgendaArea
          tenantId={route.tenantId}
          section={route.section}
          appointmentId={route.appointmentId}
        />
      )}
    </PanelShell>
  )
}

/**
 * Clinic App — login, seletor e navegação mobile first (#22).
 * Platform Admin permanece superfície separada.
 */
export function PanelApp() {
  useEffect(() => {
    void registerServiceWorker()
    const onBip = (e: Event) => captureInstallPrompt(e)
    window.addEventListener('beforeinstallprompt', onBip)
    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [])

  return (
    <div className="panel-root">
      <AuthProvider>
        <AuthModeGate>
          <TenantProvider>
            <PanelRouter />
          </TenantProvider>
        </AuthModeGate>
      </AuthProvider>
    </div>
  )
}
