import { useCallback, useEffect, useState } from 'react'
import {
  PanelApiError,
  type ClinicConfigSnapshot,
  type PanelApi,
} from '../../api'
import { friendlyError } from '../../copy/errors'

export function useClinicConfig(
  api: PanelApi | null,
  tenantId: string,
  generation: number,
) {
  const [snap, setSnap] = useState<ClinicConfigSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!api) return
    setLoading(true)
    setError(null)
    try {
      const next = await api.getClinicConfig(tenantId, {
        generation,
        expectGeneration: () => generation,
      })
      setSnap(next)
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(friendlyError(err, 'Não conseguimos carregar as configurações da clínica.'))
    } finally {
      setLoading(false)
    }
  }, [api, tenantId, generation])

  useEffect(() => {
    void reload()
  }, [reload])

  return { snap, error, loading, reload, setSnap }
}
