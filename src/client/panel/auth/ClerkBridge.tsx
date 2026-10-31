import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/react'
import { ptBR } from '@clerk/localizations'
import { AccountMenu } from '../shell/AccountMenu'
import { useEffect, type ReactNode } from 'react'
import { useAuthSession, useClientConfig } from './AuthContext'
import { clerkAppearance } from './clerkAppearance'
import { ClerkLogin } from './ClerkLogin'
import { SyntheticLogin } from './SyntheticLogin'
import { LoadingState, ErrorState } from '../states/StatusScreens'
import { navigatePanel } from '../routes'

function ClerkSessionBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth()
  const { bindClerkToken, setClerkSignedIn } = useAuthSession()

  useEffect(() => {
    bindClerkToken(async () => (await getToken()) ?? null)
    return () => bindClerkToken(null)
  }, [bindClerkToken, getToken])

  useEffect(() => {
    if (!isLoaded) return
    setClerkSignedIn(isSignedIn && userId ? userId : null)
  }, [isLoaded, isSignedIn, userId, setClerkSignedIn])

  return <>{children}</>
}

/** Envolve o painel: ClerkProvider quando AUTH_MODE=clerk; synthetic caso contrário. */
export function AuthModeGate({ children }: { children: ReactNode }) {
  const { status, authMode } = useAuthSession()
  const config = useClientConfig()

  if (status.phase === 'boot') {
    return <LoadingState label="Preparando autenticação…" />
  }
  if (status.phase === 'error') {
    return (
      <ErrorState
        title="Configuração indisponível"
        description={status.message}
        actionLabel="Recarregar"
        onAction={() => window.location.reload()}
      />
    )
  }

  if (authMode === 'clerk') {
    const pk = config?.clerkPublishableKey
    if (!pk) {
      return (
        <ErrorState
          title="Clerk não configurado"
          description="Defina CLERK_PUBLISHABLE_KEY e CLERK_SECRET_KEY no Worker e AUTH_MODE=clerk."
        />
      )
    }
    return (
      <ClerkProvider
        publishableKey={pk}
        afterSignOutUrl="/entrar"
        localization={ptBR}
        appearance={clerkAppearance}
      >
        <ClerkSessionBridge>{children}</ClerkSessionBridge>
      </ClerkProvider>
    )
  }

  return <>{children}</>
}

export function LoginScreen() {
  const { authMode } = useAuthSession()
  if (authMode === 'clerk') return <ClerkLogin />
  return <SyntheticLogin />
}

type AccountControlProps = {
  /** Posição do menu da conta (rail desktop abre para cima). */
  placement?: 'bottom end' | 'top' | 'top start' | 'top end'
}

function ClerkAccountControl({ placement }: AccountControlProps) {
  const { signOut: clearLocal } = useAuthSession()
  const { signOut, openUserProfile } = useClerk()
  const { user } = useUser()
  return (
    <AccountMenu
      name={user?.fullName ?? user?.firstName ?? null}
      email={user?.primaryEmailAddress?.emailAddress ?? null}
      placement={placement}
      onOpenProfile={() => openUserProfile({ appearance: clerkAppearance })}
      onSignOut={() => {
        void (async () => {
          await clearLocal()
          await signOut({ redirectUrl: '/entrar' })
        })()
      }}
    />
  )
}

function SyntheticAccountControl({ placement }: AccountControlProps) {
  const { signOut } = useAuthSession()
  return (
    <AccountMenu
      placement={placement}
      onSignOut={() => {
        void signOut().then(() => navigatePanel({ kind: 'entrar' }, true))
      }}
    />
  )
}

/** Avatar com menu da conta (Sair dentro do menu). */
export function AccountControl({ placement }: AccountControlProps = {}) {
  const { authMode } = useAuthSession()
  if (authMode === 'clerk') return <ClerkAccountControl placement={placement} />
  return <SyntheticAccountControl placement={placement} />
}

function ClerkSignOutControl() {
  const { signOut: clearLocal } = useAuthSession()
  const { signOut } = useClerk()
  return (
    <button
      type="button"
      className="panel-link-btn"
      onClick={() => {
        void (async () => {
          await clearLocal()
          await signOut({ redirectUrl: '/entrar' })
        })()
      }}
    >
      Sair
    </button>
  )
}

function SyntheticSignOutControl() {
  const { signOut } = useAuthSession()
  return (
    <button
      type="button"
      className="panel-link-btn"
      onClick={() => {
        void signOut().then(() => navigatePanel({ kind: 'entrar' }, true))
      }}
    >
      Sair
    </button>
  )
}

export function SignOutButton() {
  const { authMode } = useAuthSession()
  if (authMode === 'clerk') return <ClerkSignOutControl />
  return <SyntheticSignOutControl />
}
