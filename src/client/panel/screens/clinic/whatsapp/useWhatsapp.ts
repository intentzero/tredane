import { useCallback, useEffect, useState } from 'react'
import type { PanelApi, WhatsappConnection } from '../../../api'
import { PanelApiError } from '../../../api'

export function useWhatsapp(
  api: PanelApi | null,
  tenantId: string,
  generation: number,
) {
  const [conn, setConn] = useState<WhatsappConnection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!api) return
    setLoading(true)
    setError(null)
    try {
      const next = await api.getWhatsappConnection(tenantId, {
        generation,
        expectGeneration: () => generation,
      })
      setConn(next)
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(err instanceof Error ? err.message : 'erro')
    } finally {
      setLoading(false)
    }
  }, [api, tenantId, generation])

  useEffect(() => {
    void reload()
  }, [reload])

  return { conn, error, loading, reload, setConn }
}
