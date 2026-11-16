import { useAuthSession } from '../../auth/AuthContext'
import { useTenant } from '../../tenant/TenantContext'
import {
  InboxRealtimeProvider,
  isAcompanhamentoEvent,
} from '../../realtime/InboxRealtime'
import { LoadingState } from '../../states/StatusScreens'
import type { AcompanhamentoSection } from '../../routes'
import { AcompanhamentoBoard } from './AcompanhamentoBoard'
import { AcompanhamentoDetail } from './AcompanhamentoDetail'
import { AcompanhamentoWideBoard } from './AcompanhamentoWideBoard'
import { useMediaQuery } from '../../ui/useMediaQuery'

type Props = {
  tenantId: string
  section: AcompanhamentoSection
  opportunityId?: string
}

/**
 * Área Acompanhamento (#30): quadro por etapa + detalhe do contato em andamento.
 * Sem editor livre de etapas, sem WhatsApp F3, sem agenda completa (#35/#36).
 */
export function AcompanhamentoArea({ tenantId, section, opportunityId }: Props) {
  const { api, status } = useAuthSession()
  const { generation } = useTenant()
  const wide = useMediaQuery('(min-width: 1280px)')

  if (!api || status.phase !== 'ready') {
    return <LoadingState label="Preparando sessão…" />
  }

  // WS da clínica: cartões ao vivo (mensagem/IA/compromisso) + contact.deleted (AC-52).
  // Faixa «Precisa de alguém» vive no PanelShell (DEC-156 A+E, 16/11/2026).
  return (
    <InboxRealtimeProvider
      tenantId={tenantId}
      api={api}
      generation={generation}
      acceptEvent={isAcompanhamentoEvent}
    >
      {wide ? (
        <AcompanhamentoWideBoard
          tenantId={tenantId}
          api={api}
          generation={generation}
          openId={section === 'detalhe' ? opportunityId : undefined}
        />
      ) : section === 'detalhe' && opportunityId ? (
        <AcompanhamentoDetail
          tenantId={tenantId}
          opportunityId={opportunityId}
          api={api}
          generation={generation}
        />
      ) : (
        <AcompanhamentoBoard tenantId={tenantId} api={api} generation={generation} />
      )}
    </InboxRealtimeProvider>
  )
}
