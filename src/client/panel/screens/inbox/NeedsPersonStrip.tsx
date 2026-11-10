/**
 * DEC-156 — faixa persistente enquanto houver conversa «Precisa de alguém».
 * Some no Assumir (`clearedAwaitingTeam`) ou resume timeout/manual (DEC-155).
 */
import { Bell } from 'lucide-react'
import { Button } from 'react-aria-components'
import { navigatePanel } from '../../routes'

type Props = {
  tenantId: string
  count: number
  /** Conversa a abrir se count === 1. */
  conversationId?: string | null
}

export function NeedsPersonStrip({ tenantId, count, conversationId }: Props) {
  if (count <= 0) return null
  const label =
    count === 1
      ? 'Uma conversa precisa de alguém. Assuma para continuar.'
      : `${count} conversas precisam de alguém. Assuma para continuar.`
  return (
    <div
      className="panel-strip panel-strip-needs-person"
      role="alert"
      aria-live="assertive"
      data-testid="needs-person-strip"
    >
      <Bell size={16} aria-hidden strokeWidth={2} />
      <p>{label}</p>
      <Button
        className="panel-btn panel-btn-ghost panel-btn-sm"
        onPress={() => {
          if (count === 1 && conversationId) {
            navigatePanel({
              kind: 'area',
              area: 'conversas',
              tenantId,
              section: 'thread',
              conversationId,
            })
            return
          }
          navigatePanel({
            kind: 'area',
            area: 'conversas',
            tenantId,
            section: 'lista',
          })
        }}
      >
        {count === 1 ? 'Abrir' : 'Ver lista'}
      </Button>
    </div>
  )
}
