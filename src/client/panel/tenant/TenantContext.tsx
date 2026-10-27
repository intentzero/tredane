import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { PanelApiError, type TenantContextResponse, type TenantSummary } from '../api'
import { useAuthSession } from '../auth/AuthContext'
import {
  clearPickingClinic,
  readActiveTenantId,
  writeActiveTenantId,
  writeLastTenantId,
} from '../auth/session'

type TenantLoadState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; tenants: TenantSummary[] }
  | { phase: 'empty' }
  | { phase: 'error'; message: string; code?: string }
  | { phase: 'unauthenticated' }

type ActiveTenantState =
  | { phase: 'none' }
  | { phase: 'switching'; tenantId: string; nameHint?: string }
  | { phase: 'ready'; context: TenantContextResponse }
  | { phase: 'forbidden'; tenantId: string }
  | { phase: 'ended'; tenantId: string }
  | { phase: 'error'; tenantId: string; message: string }

type TenantContextValue = {
  listState: TenantLoadState
  active: ActiveTenantState
  generation: number
  reloadTenants: () => void
  selectTenant: (tenantId: string, nameHint?: string) => Promise<boolean>
  clearTenant: () => void
  beginSwitch: (tenantId: string, nameHint?: string) => number
}

const TenantCtx = createContext<TenantContextValue | null>(null)

export function TenantProvider({ children }: { children: ReactNode }) {
  const { api, signedIn } = useAuthSession()
  const [listState, setListState] = useState<TenantLoadState>({ phase: 'idle' })
  const [active, setActive] = useState<ActiveTenantState>({ phase: 'none' })
  const generationRef = useRef(0)
  const listAbortRef = useRef<AbortController | null>(null)
  const contextAbortRef = useRef<AbortController | null>(null)
  const [generation, setGeneration] = useState(0)

  const bumpGeneration = useCallback(() => {
    generationRef.current += 1
    setGeneration(generationRef.current)
    return generationRef.current
  }, [])

  const cancelContext = useCallback(() => {
    contextAbortRef.current?.abort()
    contextAbortRef.current = null
  }, [])

  const cancelList = useCallback(() => {
    listAbortRef.current?.abort()
    listAbortRef.current = null
  }, [])

  const clearSensitive = useCallback(() => {
    cancelContext()
    bumpGeneration()
    // #42 / UX-05 — troca de clínica não reutiliza cache da anterior.
    void import('../pwa')
      .then((m) => m.clearPwaCaches())
      .catch(() => undefined)
  }, [cancelContext, bumpGeneration])

  const reloadTenants = useCallback(() => {
    if (!api || !signedIn) {
      setListState({ phase: 'idle' })
      return
    }
    cancelList()
    const controller = new AbortController()
    listAbortRef.current = controller
    const gen = generationRef.current
    setListState({ phase: 'loading' })
    void (async () => {
      try {
        const tenants = await api.listTenants({
          signal: controller.signal,
          generation: gen,
          expectGeneration: () => generationRef.current,
        })
        if (controller.signal.aborted) return
        // Lista pode completar após troca de clínica: ainda é válida se a sessão for a mesma.
        if (tenants.length === 0) setListState({ phase: 'empty' })
        else setListState({ phase: 'ready', tenants })
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
        if (err instanceof PanelApiError && (err.status === 401 || err.code === 'unauthenticated')) {
          setListState({ phase: 'unauthenticated' })
          return
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar as clínicas.',
          code: err instanceof PanelApiError ? err.code : undefined,
        })
      }
    })()
  }, [api, signedIn, cancelList])

  useEffect(() => {
    if (!signedIn) {
      cancelList()
      cancelContext()
      writeActiveTenantId(null)
      setListState({ phase: 'idle' })
      setActive({ phase: 'none' })
      return
    }
    reloadTenants()
  }, [signedIn, reloadTenants, cancelList, cancelContext])

  const beginSwitch = useCallback(
    (tenantId: string, nameHint?: string) => {
      clearSensitive()
      setActive({ phase: 'switching', tenantId, nameHint })
      return generationRef.current
    },
    [clearSensitive],
  )

  const selectTenant = useCallback(
    async (tenantId: string, nameHint?: string): Promise<boolean> => {
      if (!api) return false
      const gen = beginSwitch(tenantId, nameHint)
      const controller = new AbortController()
      contextAbortRef.current = controller
      try {
        const context = await api.getTenantContext(tenantId, {
          signal: controller.signal,
          generation: gen,
          expectGeneration: () => generationRef.current,
        })
        if (controller.signal.aborted || gen !== generationRef.current) return false
        writeActiveTenantId(context.tenantId)
        writeLastTenantId(context.tenantId)
        clearPickingClinic()
        setActive({ phase: 'ready', context })
        return true
      } catch (err) {
        if (controller.signal.aborted || gen !== generationRef.current) return false
        if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return false
        if (
          err instanceof PanelApiError &&
          (err.code === 'tenant_access_denied' || err.code === 'permission_denied')
        ) {
          writeActiveTenantId(null)
          writeLastTenantId(null)
          setActive({ phase: 'forbidden', tenantId })
          return false
        }
        if (err instanceof PanelApiError && err.code === 'tenant_not_active') {
          writeActiveTenantId(null)
          writeLastTenantId(null)
          setActive({ phase: 'ended', tenantId })
          return false
        }
        setActive({
          phase: 'error',
          tenantId,
          message: 'Não foi possível abrir esta clínica.',
        })
        return false
      }
    },
    [api, beginSwitch],
  )

  const clearTenant = useCallback(() => {
    clearSensitive()
    writeActiveTenantId(null)
    setActive({ phase: 'none' })
  }, [clearSensitive])

  useEffect(() => {
    if (!signedIn || !api) return
    if (active.phase !== 'none') return
    const stored = readActiveTenantId()
    if (stored) void selectTenant(stored)
  }, [signedIn, api, active.phase, selectTenant])

  const value = useMemo<TenantContextValue>(
    () => ({
      listState,
      active,
      generation,
      reloadTenants,
      selectTenant,
      clearTenant,
      beginSwitch,
    }),
    [listState, active, generation, reloadTenants, selectTenant, clearTenant, beginSwitch],
  )

  return <TenantCtx.Provider value={value}>{children}</TenantCtx.Provider>
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantCtx)
  if (!ctx) throw new Error('useTenant fora de TenantProvider')
  return ctx
}
