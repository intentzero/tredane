import { useEffect, useState } from 'react'
import { AuthProvider, useAuthSession } from './auth/AuthContext'
import { AuthModeGate, LoginScreen } from './auth/ClerkBridge'
import { ClinicSelector } from './screens/ClinicSelector'
import { AreaPlaceholder } from './screens/AreaPlaceholders'
import { ClinicArea } from './screens/clinic/ClinicArea'
import { ConversasArea } from './screens/inbox/ConversasArea'
import { AcompanhamentoArea } from './screens/acompanhamento/AcompanhamentoArea'
import { PanelShell } from './shell/PanelShell'
import { LoadingState } from './states/StatusScreens'
import { TenantProvider, useTenant } from './tenant/TenantContext'
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
  const { signedIn, status } = useAuthSession()
  const { selectTenant, active } = useTenant()

  useEffect(() => {
    if (status.phase !== 'ready') return
    if (!route) return

    if (!signedIn && route.kind !== 'entrar') {
      navigatePanel({ kind: 'entrar' }, true)
      return
    }
    if (signedIn && route.kind === 'entrar') {
      navigatePanel({ kind: 'clinicas' }, true)
    }
  }, [signedIn, route, status.phase])

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

  if (!signedIn) {
    return <LoadingState label="A redirecionar para entrar…" />
  }

  if (route.kind === 'clinicas') {
    return <ClinicSelector />
  }

  return (
    <PanelShell area={route.area} tenantId={route.tenantId}>
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
        <AreaPlaceholder area={route.area} />
      )}
    </PanelShell>
  )
}

/**
 * Clinic App — login, seletor e navegação mobile first (#22).
 * Platform Admin permanece superfície separada.
 */
export function PanelApp() {
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
