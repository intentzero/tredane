import { AlertTriangle, Ban, Inbox, LoaderCircle, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from 'react-aria-components'

type Props = {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}

function Frame({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: Props & { icon: ReactNode }) {
  return (
    <div className="panel-status" role="status">
      <div className="panel-status-icon" aria-hidden="true">
        {icon}
      </div>
      <h2 className="panel-title">{title}</h2>
      <p className="panel-status-desc">{description}</p>
      {actionLabel && onAction ? (
        <Button className="panel-btn-primary panel-status-action" onPress={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

export function LoadingState({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="panel-status" role="status" aria-live="polite" aria-busy="true">
      <LoaderCircle className="panel-spin" aria-hidden="true" size={28} strokeWidth={2} />
      <p className="panel-status-desc">{label}</p>
    </div>
  )
}

export function EmptyState(props: Props) {
  return (
    <Frame
      {...props}
      icon={<Inbox aria-hidden="true" size={28} strokeWidth={2} />}
    />
  )
}

export function ErrorState(props: Props) {
  return (
    <Frame
      {...props}
      icon={<WifiOff aria-hidden="true" size={28} strokeWidth={2} />}
    />
  )
}

export function ForbiddenState(props: Props) {
  return (
    <Frame
      {...props}
      icon={<Ban aria-hidden="true" size={28} strokeWidth={2} />}
    />
  )
}

export function AccessEndedState(props: Props) {
  return (
    <Frame
      {...props}
      icon={<AlertTriangle aria-hidden="true" size={28} strokeWidth={2} />}
    />
  )
}
