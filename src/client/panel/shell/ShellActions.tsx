import { Bell, BellOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import { AccountControl } from '../auth/ClerkBridge'
import {
  getExistingPushSubscription,
  PUSH_SUBSCRIPTION_CHANGED_EVENT,
} from '../pwa'
import { navigatePanel } from '../routes'

type Props = {
  tenantId: string
  /** Classe do contentor (cabeçalho ou rail). */
  className: string
  /** Menu da conta: no rail desktop abre para cima. */
  accountPlacement?: 'bottom end' | 'top' | 'top start' | 'top end'
}

/** null = a carregar / indeterminado; true = push activo; false = sem subscrição. */
type PushActive = boolean | null

function useDevicePushActive(): PushActive {
  const [active, setActive] = useState<PushActive>(null)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void getExistingPushSubscription().then((sub) => {
        if (!cancelled) setActive(Boolean(sub))
      })
    }
    refresh()
    window.addEventListener(PUSH_SUBSCRIPTION_CHANGED_EVENT, refresh)
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      window.removeEventListener(PUSH_SUBSCRIPTION_CHANGED_EVENT, refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return active
}

/**
 * Sino de avisos + avatar da conta.
 * No celular fica no cabeçalho; no desktop (≥ 1280 px) no fundo do menu lateral
 * (mock ConversasDesktopProposta / DEC-068). CSS esconde uma das duas instâncias.
 *
 * Estado visual do sino (Confirmado Paulo / mock notif-estado-sino):
 * ligado = Bell + success-ink; desligado = BellOff + danger-ink;
 * indeterminado = Bell + text-primary. O clique continua a abrir Avisos.
 */
export function ShellActions({ tenantId, className, accountPlacement }: Props) {
  const pushActive = useDevicePushActive()

  const avisosClass =
    pushActive === true
      ? 'panel-icon-btn panel-icon-btn--avisos-on'
      : pushActive === false
        ? 'panel-icon-btn panel-icon-btn--avisos-off'
        : 'panel-icon-btn'

  const avisosLabel =
    pushActive === true
      ? 'Avisos ligados — abrir Avisos'
      : pushActive === false
        ? 'Avisos desligados — abrir Avisos'
        : 'Avisos no celular'

  return (
    <div className={className}>
      <Button
        className={avisosClass}
        aria-label={avisosLabel}
        onPress={() => navigatePanel({ kind: 'area', area: 'avisos', tenantId })}
      >
        {pushActive === false ? (
          <BellOff aria-hidden="true" size={20} strokeWidth={2} />
        ) : (
          <Bell aria-hidden="true" size={20} strokeWidth={2} />
        )}
      </Button>
      <AccountControl placement={accountPlacement} />
    </div>
  )
}
