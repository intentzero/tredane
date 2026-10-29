import { Plus } from 'lucide-react'
import { Button, Switch } from 'react-aria-components'

type Props = {
  /** «2 profissionais ativas». */
  count: string
  /** «Mostrar inativos» / «Mostrar inativas». */
  switchLabel: string
  showInactive: boolean
  onShowInactive: (value: boolean) => void
  addLabel: string
  onAdd: () => void
}

/** Cabeçalho comum de Profissionais, Salas e Serviços: contagem, chave e ação principal. */
export function ClinicListHeader({
  count,
  switchLabel,
  showInactive,
  onShowInactive,
  addLabel,
  onAdd,
}: Props) {
  return (
    <div className="clinic-list-header">
      <div className="clinic-list-meta">
        <p className="clinic-list-count">{count}</p>
        <Switch className="clinic-switch" isSelected={showInactive} onChange={onShowInactive}>
          <span className="clinic-switch-track" aria-hidden>
            <span className="clinic-switch-thumb" />
          </span>
          {switchLabel}
        </Switch>
      </div>
      <Button className="panel-btn panel-btn-primary clinic-list-add" onPress={onAdd}>
        <Plus size={18} strokeWidth={2.2} aria-hidden />
        {addLabel}
      </Button>
    </div>
  )
}
