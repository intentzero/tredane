import { useEffect, useState } from 'react'
import type { TenantSummary } from '../api'
import type { PanelArea } from '../routes'
import { ClinicSwitcher } from './ClinicSwitcher'

/** `navigator.onLine` reativo, para o indicador «Ao vivo» / «Sem conexão». */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

type Props = {
  tenantId: string
  name: string
  area: PanelArea
  tenants: TenantSummary[]
  offline: boolean
}

/** Clínica ativa (com a troca) e estado da ligação em tempo real. */
export function ShellIdentity({ tenantId, name, area, tenants, offline }: Props) {
  return (
    <div className="panel-shell-clinic">
      <ClinicSwitcher tenantId={tenantId} name={name} area={area} tenants={tenants} />
      <span
        className={`panel-live${offline ? ' panel-live--offline' : ''}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="panel-live-dot" aria-hidden="true" />
        {offline ? 'Sem conexão' : 'Ao vivo'}
      </span>
    </div>
  )
}
