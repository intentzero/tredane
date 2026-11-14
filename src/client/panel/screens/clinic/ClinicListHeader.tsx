import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, Switch } from 'react-aria-components'
import { useMediaQuery } from '../../ui/useMediaQuery'
import { ShellSlot } from '../../shell/ShellSlot'

type Props = {
  /** «2 profissionais ativas». */
  count: string
  /** «Mostrar inativos» / «Mostrar inativas». */
  switchLabel: string
  showInactive: boolean
  onShowInactive: (value: boolean) => void
  addLabel: string
  onAdd: () => void
  /** Busca no desktop (DEC-183): fica no cabeçalho, entre a contagem e a ação. */
  search?: ReactNode
}

/** Cabeçalho comum de Profissionais, Salas e Serviços: contagem, chave e ação principal. */
export function ClinicListHeader({
  count,
  switchLabel,
  showInactive,
  onShowInactive,
  addLabel,
  onAdd,
  search,
}: Props) {
  const wide = useMediaQuery('(min-width: 1280px)')
  const header = (
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
      {wide && search ? <div className="clinic-list-search">{search}</div> : null}
      <Button className="panel-btn panel-btn-primary clinic-list-add" onPress={onAdd}>
        <Plus size={18} strokeWidth={2.2} aria-hidden />
        {addLabel}
      </Button>
    </div>
  )
  // DEC-183: no desktop, contagem, chave e ação sobem para o cabeçalho do shell, ao lado do título.
  return wide ? <ShellSlot>{header}</ShellSlot> : header
}
