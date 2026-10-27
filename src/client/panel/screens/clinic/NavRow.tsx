import { ChevronRight, type LucideIcon } from 'lucide-react'
import { Button } from 'react-aria-components'
import { Badge } from '../../states/Badge'

export type NavRowState = 'ok' | 'todo' | 'neutral' | 'danger'

type Props = {
  icon: LucideIcon
  title: string
  detail: string
  state?: NavRowState
  /** Selo «Em breve»: recurso que ainda não existe (linha só informativa). */
  soon?: boolean
  /** Sem `onPress` a linha é só informativa (ex.: recurso que ainda não existe). */
  onPress?: () => void
}

/**
 * Linha de lista com ícone colorido pelo estado, título, resumo e seta.
 * `todo` mostra o selo «Falta»; `ok` anuncia «Pronto» só para leitor de tela.
 */
export function NavRow({ icon: Icon, title, detail, state = 'neutral', soon, onPress }: Props) {
  const content = (
    <>
      <span className={`clinic-nav-icon clinic-nav-icon--${state}`} aria-hidden>
        <Icon size={20} strokeWidth={2} />
      </span>
      <span className={`clinic-nav-copy${state === 'danger' ? ' clinic-nav-copy--danger' : ''}`}>
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      {soon ? <Badge tone="wait">Em breve</Badge> : null}
      {state === 'todo' ? <Badge tone="wait">Falta</Badge> : null}
      {state === 'ok' ? <span className="panel-sr-only">Pronto</span> : null}
      {onPress ? <ChevronRight aria-hidden size={18} /> : null}
    </>
  )
  if (!onPress) {
    return <div className="clinic-nav-row clinic-nav-row-static">{content}</div>
  }
  return (
    <Button className="clinic-nav-row" onPress={onPress}>
      {content}
    </Button>
  )
}
