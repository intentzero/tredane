import { Bell } from 'lucide-react'
import { Button } from 'react-aria-components'
import { AccountControl } from '../auth/ClerkBridge'
import { navigatePanel } from '../routes'

type Props = {
  tenantId: string
  /** Classe do contentor (cabeçalho ou rail). */
  className: string
  /** Menu da conta: no rail desktop abre para cima. */
  accountPlacement?: 'bottom end' | 'top' | 'top start' | 'top end'
}

/**
 * Sino de avisos + avatar da conta.
 * No celular fica no cabeçalho; no desktop (≥ 1280 px) no fundo do menu lateral
 * (mock ConversasDesktopProposta / DEC-068). CSS esconde uma das duas instâncias.
 */
export function ShellActions({ tenantId, className, accountPlacement }: Props) {
  return (
    <div className={className}>
      <Button
        className="panel-icon-btn"
        aria-label="Avisos no celular"
        onPress={() => navigatePanel({ kind: 'area', area: 'avisos', tenantId })}
      >
        <Bell aria-hidden="true" size={20} strokeWidth={2} />
      </Button>
      <AccountControl placement={accountPlacement} />
    </div>
  )
}
