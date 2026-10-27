import { useCallback, useEffect, useState } from 'react'
import type { PanelApi, WhatsappConnection } from '../../../api'
import { PanelApiError } from '../../../api'
import { errorDetail, friendlyError } from '../../../copy/errors'

export function useWhatsapp(
  api: PanelApi | null,
  tenantId: string,
  generation: number,
) {
  const [conn, setConn] = useState<WhatsappConnection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!api) return
    setLoading(true)
    setError(null)
    setDetail(null)
    try {
      const next = await api.getWhatsappConnection(tenantId, {
        generation,
        expectGeneration: () => generation,
      })
      setConn(next)
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(friendlyError(err, 'Não conseguimos carregar. Tente de novo.'))
      setDetail(errorDetail(err))
    } finally {
      setLoading(false)
    }
  }, [api, tenantId, generation])

  useEffect(() => {
    void reload()
  }, [reload])

  return { conn, error, detail, loading, reload, setConn }
}
