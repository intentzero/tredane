/**
 * Fuso da clínica (configurável em Agenda → Horários; padrão Brasília).
 * Guardado por módulo para formatadores sem React (dia/hora na Conversa,
 * mensagens) e exposto por hook para os ecrãs carregarem uma vez por clínica.
 */
import { useEffect, useState } from 'react'
import type { PanelApi } from './api'

export const DEFAULT_CLINIC_TIMEZONE = 'America/Sao_Paulo'

let current = DEFAULT_CLINIC_TIMEZONE
const byTenant = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

export function getClinicTimezone(): string {
  return current
}

export function setClinicTimezone(tenantId: string, timezone: string | null | undefined): void {
  const tz = timezone || DEFAULT_CLINIC_TIMEZONE
  byTenant.set(tenantId, tz)
  current = tz
}

export function useClinicTimezone(api: PanelApi, tenantId: string, generation: number): string {
  const [tz, setTz] = useState(() => byTenant.get(tenantId) ?? DEFAULT_CLINIC_TIMEZONE)
  useEffect(() => {
    let cancelled = false
    const known = byTenant.get(tenantId)
    if (known) {
      current = known
      setTz(known)
      return
    }
    // Mocks de teste sem config: fica no padrão.
    if (typeof api.getClinicConfig !== 'function') return
    let p = inflight.get(tenantId)
    if (!p) {
      p = api
        .getClinicConfig(tenantId, { generation, expectGeneration: () => generation })
        .then((snap) => {
          setClinicTimezone(tenantId, snap.settings.timezone)
          return byTenant.get(tenantId)!
        })
        .finally(() => inflight.delete(tenantId))
      inflight.set(tenantId, p)
    }
    p.then((value) => {
      if (!cancelled) setTz(value)
    }).catch(() => {
      /* mantém o padrão */
    })
    return () => {
      cancelled = true
    }
  }, [api, tenantId, generation])
  return tz
}
