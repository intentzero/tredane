import { Button } from 'react-aria-components'
import { useAuthSession } from '../../auth/AuthContext'
import { useTenant } from '../../tenant/TenantContext'
import type { AgendaSection } from '../../routes'
import { navigatePanel } from '../../routes'
import { EmptyState, LoadingState } from '../../states/StatusScreens'
import { AgendarScreen } from './AgendarScreen'

type Props = {
  tenantId: string
  section: AgendaSection
}

/**
 * Área Agenda (#35): visão do dia (placeholder até #36) + Agendar (consulta).
 */
export function AgendaArea({ tenantId, section }: Props) {
  const { api } = useAuthSession()
  const { active, generation } = useTenant()

  if (active.phase === 'switching') {
    return <LoadingState label="A mudar de clínica…" />
  }
  if (active.phase === 'forbidden') {
    return (
      <EmptyState
        title="Sem acesso a esta clínica"
        description="Peça convite ao responsável ou escolha outra clínica."
      />
    )
  }
  if (!api || active.phase !== 'ready') {
    return <LoadingState label="A preparar a agenda…" />
  }

  if (section === 'agendar') {
    return (
      <AgendarScreen
        tenantId={tenantId}
        api={api}
        generation={generation}
      />
    )
  }

  return (
    <div className="agenda-day">
      <EmptyState
        title="Agenda do dia"
        description="Compromissos confirmados e espaços livres. Use Agendar para consultar disponibilidade por profissional e sala (confirmação atómica na fatia seguinte)."
      />
      <div style={{ padding: '0 16px 24px' }}>
        <Button
          className="panel-btn-primary"
          onPress={() =>
            navigatePanel({
              kind: 'area',
              area: 'agenda',
              tenantId,
              section: 'agendar',
            })
          }
        >
          Agendar horário
        </Button>
      </div>
    </div>
  )
}
