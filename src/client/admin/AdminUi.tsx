import type { ReactNode } from 'react'
import { ErrorState, LoadingState } from '../panel/states/StatusScreens'
import type { PillTone } from './format'

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span className={`admin-pill admin-pill--${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  )
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="admin-page-header">
      <div className="admin-page-title">
        <h1>{title}</h1>
        {sub ? <span className="admin-muted">{sub}</span> : null}
      </div>
      {actions ? <div className="admin-page-actions">{actions}</div> : null}
    </div>
  )
}

export function AdminLoading({ label }: { label: string }) {
  return <LoadingState label={label} />
}

export function AdminLoadError({ onRetry, what }: { onRetry: () => void; what: string }) {
  return (
    <ErrorState
      title={`Não foi possível carregar ${what}`}
      description="Verifique a internet e tente de novo."
      actionLabel="Tentar de novo"
      onAction={onRetry}
    />
  )
}
