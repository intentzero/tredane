import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  createPanelApi,
  fetchClientAuthConfig,
  type AuthMode,
  type ClientAuthConfig,
  type PanelApi,
} from '../api'
import {
  readSynthUserId,
  synthBearer,
  writeActiveTenantId,
  writeSynthUserId,
} from './session'

type AuthStatus =
  | { phase: 'boot' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; config: ClientAuthConfig }

type AuthContextValue = {
  status: AuthStatus
  authMode: AuthMode | null
  signedIn: boolean
  clerkUserId: string | null
  api: PanelApi | null
  signInSynthetic: (clerkUserId: string) => void
  signOut: () => Promise<void>
  /** Injeta getToken do Clerk quando authMode=clerk. */
  bindClerkToken: (getToken: (() => Promise<string | null>) | null) => void
  setClerkSignedIn: (userId: string | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>({ phase: 'boot' })
  const [synthUserId, setSynthUserId] = useState<string | null>(() => readSynthUserId())
  const [clerkUserId, setClerkUserId] = useState<string | null>(null)
  const [clerkGetToken, setClerkGetToken] = useState<(() => Promise<string | null>) | null>(
    null,
  )

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const config = await fetchClientAuthConfig(controller.signal)
        if (!controller.signal.aborted) setStatus({ phase: 'ready', config })
      } catch {
        if (!controller.signal.aborted) {
          setStatus({
            phase: 'error',
            message: 'Não foi possível obter a configuração de autenticação.',
          })
        }
      }
    })()
    return () => controller.abort()
  }, [])

  const authMode = status.phase === 'ready' ? status.config.authMode : null

  const getToken = useCallback(async (): Promise<string | null> => {
    if (authMode === 'synthetic') {
      const id = synthUserId ?? readSynthUserId()
      return id ? synthBearer(id) : null
    }
    if (authMode === 'clerk' && clerkGetToken) {
      return clerkGetToken()
    }
    return null
  }, [authMode, synthUserId, clerkGetToken])

  const api = useMemo(() => {
    if (status.phase !== 'ready') return null
    return createPanelApi(getToken)
  }, [status.phase, getToken])

  const signedIn =
    authMode === 'synthetic'
      ? Boolean(synthUserId)
      : authMode === 'clerk'
        ? Boolean(clerkUserId)
        : false

  const resolvedUserId =
    authMode === 'synthetic' ? synthUserId : authMode === 'clerk' ? clerkUserId : null

  const signInSynthetic = useCallback((userId: string) => {
    writeSynthUserId(userId)
    setSynthUserId(userId)
  }, [])

  const signOut = useCallback(async () => {
    writeSynthUserId(null)
    writeActiveTenantId(null)
    setSynthUserId(null)
    setClerkUserId(null)
  }, [])

  const bindClerkToken = useCallback((fn: (() => Promise<string | null>) | null) => {
    setClerkGetToken(() => fn)
  }, [])

  const setClerkSignedIn = useCallback((userId: string | null) => {
    setClerkUserId(userId)
    if (!userId) writeActiveTenantId(null)
  }, [])

  const value: AuthContextValue = {
    status,
    authMode,
    signedIn,
    clerkUserId: resolvedUserId,
    api,
    signInSynthetic,
    signOut,
    bindClerkToken,
    setClerkSignedIn,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthSession(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthSession fora de AuthProvider')
  return ctx
}

export function useClientConfig(): ClientAuthConfig | null {
  const { status } = useAuthSession()
  return status.phase === 'ready' ? status.config : null
}
