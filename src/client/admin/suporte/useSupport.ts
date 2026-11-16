import { useCallback, useEffect, useState } from 'react'
import type { SupportItem } from '../api'
import { useAdminApi } from '../useAdminApi'

export type SupportLoad = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; items: SupportItem[] }

/** O estado dos pedidos muda com decisões das owners: relê de 30 em 30 s (spec, Q-PA-03 em aberto). */
const POLL_MS = 30_000

export function useSupport(tenantId?: string): { load: SupportLoad; reload: () => void } {
  const api = useAdminApi()
  const [load, setLoad] = useState<SupportLoad>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const read = () =>
      (tenantId ? api.listTenantSupport(tenantId, { signal: controller.signal }) : api.listSupport({ signal: controller.signal }))
        .then((items) => {
          if (!controller.signal.aborted) setLoad({ phase: 'ready', items })
        })
        .catch(() => {
          // Uma falha de polling não apaga o que já está no ecrã.
          if (!controller.signal.aborted) setLoad((prev) => (prev.phase === 'ready' ? prev : { phase: 'error' }))
        })
    setLoad((prev) => (prev.phase === 'ready' ? prev : { phase: 'loading' }))
    void read()
    const id = window.setInterval(() => void read(), POLL_MS)
    return () => {
      controller.abort()
      window.clearInterval(id)
    }
  }, [api, tenantId, attempt])

  return { load, reload: useCallback(() => setAttempt((n) => n + 1), []) }
}
