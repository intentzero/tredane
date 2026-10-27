import { useAuthSession } from '../../auth/AuthContext'
import { useTenant } from '../../tenant/TenantContext'
import { LoadingState } from '../../states/StatusScreens'
import type { AcompanhamentoSection } from '../../routes'
import { AcompanhamentoBoard } from './AcompanhamentoBoard'
import { AcompanhamentoDetail } from './AcompanhamentoDetail'

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

  if (!api || status.phase !== 'ready') {
    return <LoadingState label="Preparando sessão…" />
  }

  if (section === 'detalhe' && opportunityId) {
    return (
      <AcompanhamentoDetail
        tenantId={tenantId}
        opportunityId={opportunityId}
        api={api}
        generation={generation}
      />
    )
  }

  return (
    <AcompanhamentoBoard tenantId={tenantId} api={api} generation={generation} />
  )
}
