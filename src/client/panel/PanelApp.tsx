import { useEffect, useState } from 'react'
import { AuthProvider, useAuthSession } from './auth/AuthContext'
import { AuthModeGate, LoginScreen } from './auth/ClerkBridge'
import {
  captureInviteTokenFromLocation,
  readPendingInviteToken,
} from './auth/session'
import { AcceptInviteScreen } from './screens/AcceptInviteScreen'
import { ClinicSelector } from './screens/ClinicSelector'
import { ClinicArea } from './screens/clinic/ClinicArea'
import { ConversasArea } from './screens/inbox/ConversasArea'
import { AcompanhamentoArea } from './screens/acompanhamento/AcompanhamentoArea'
import { AgendaArea } from './screens/agenda/AgendaArea'
import { ClientesArea } from './screens/clientes/ClientesArea'
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
    resolvePanelRoute(window.location.pathname, window.location.search),
  )
  useEffect(() => {
    const onPop = () =>
      setRoute(resolvePanelRoute(window.location.pathname, window.location.search))
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

    // Link do e-mail: guarda o token antes de mandar para o login.
    if (route.kind === 'invite-accept') {
      captureInviteTokenFromLocation()
      if (!signedIn) {
        navigatePanel({ kind: 'entrar' }, true)
        return
      }
    }

    if (!signedIn && route.kind !== 'entrar') {
      navigatePanel({ kind: 'entrar' }, true)
      return
    }

    // Após login (Clerk forceRedirect / synthetic), retoma o aceite se houver token.
    if (signedIn && (route.kind === 'entrar' || route.kind === 'clinicas')) {
      if (readPendingInviteToken()) {
        navigatePanel({ kind: 'invite-accept' }, true)
        return
      }
      if (route.kind === 'entrar') {
        navigatePanel({ kind: 'clinicas' }, true)
      }
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
    return <LoadingState label="Abrindo a entrada…" />
  }

  if (route.kind === 'invite-accept') {
    return <AcceptInviteScreen />
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
      ) : route.area === 'clientes' ? (
        <ClientesArea
          tenantId={route.tenantId}
          section={route.section}
          contactId={route.contactId}
        />
      ) : (
        <AgendaArea
          tenantId={route.tenantId}
          section={route.section}
          appointmentId={route.appointmentId}
          focusDate={route.date}
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
