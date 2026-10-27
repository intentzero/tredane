import { useAuthSession } from '../../auth/AuthContext'
import { useTenant } from '../../tenant/TenantContext'
import type { AgendaSection } from '../../routes'
import { EmptyState, LoadingState } from '../../states/StatusScreens'
import { AgendarScreen } from './AgendarScreen'
import { AgendaDayWeek } from './AgendaDayWeek'
import { CompromissoScreen } from './CompromissoScreen'

type Props = {
  tenantId: string
  section: AgendaSection
  appointmentId?: string
}

/**
 * Área Agenda (#35/#36): dia/semana, detalhe e Agendar com confirmação atómica.
 */
export function AgendaArea({ tenantId, section, appointmentId }: Props) {
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
    return <LoadingState label="Preparando a agenda…" />
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

  if (section === 'compromisso' && appointmentId) {
    return (
      <CompromissoScreen
        tenantId={tenantId}
        appointmentId={appointmentId}
        api={api}
        generation={generation}
      />
    )
  }

  return (
    <AgendaDayWeek
      tenantId={tenantId}
      api={api}
      generation={generation}
      view={section === 'semana' ? 'week' : 'day'}
    />
  )
}
