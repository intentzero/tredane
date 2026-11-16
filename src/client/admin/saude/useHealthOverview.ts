import { useCallback, useEffect, useState } from 'react'
import type { HealthOverview } from '../api'
import { useAdminApi } from '../useAdminApi'

export type OverviewLoad =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; overview: HealthOverview }

/** O resumo muda de 10 em 10 minutos (cron); reler de minuto a minuto é barato (só D1). */
const POLL_MS = 60_000

export function useHealthOverview(): { load: OverviewLoad; reload: () => void } {
  const api = useAdminApi()
  const [load, setLoad] = useState<OverviewLoad>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const read = () =>
      api
        .getHealthOverview({ signal: controller.signal })
        .then((overview) => {
          if (!controller.signal.aborted) setLoad({ phase: 'ready', overview })
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
  }, [api, attempt])

  return { load, reload: useCallback(() => setAttempt((n) => n + 1), []) }
}

/** O cron deveria ter corrido há menos de 2 intervalos; senão o resumo está parado. */
export function summaryIsStale(overview: HealthOverview, nowMs = Date.now()): boolean {
  return overview.summaryAt === null || nowMs - overview.summaryAt > overview.refreshIntervalMs * 2
}
