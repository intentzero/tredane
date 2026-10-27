import { useAuthSession } from '../../auth/AuthContext'
import { useTenant } from '../../tenant/TenantContext'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import type { ClinicaSection } from '../../routes'
import { ClinicHub } from './ClinicHub'
import { ResourceForm, ResourcesList } from './ResourcesScreen'
import { SchedulesScreen } from './SchedulesScreen'
import { ServiceForm, ServicesList } from './ServicesScreen'
import { useClinicConfig } from './useClinicConfig'
import { WhatsappScreen } from './whatsapp/WhatsappScreen'
import { RecebimentoScreen } from './pix/RecebimentoScreen'
import { WhatsappDevSyncScreen } from './whatsapp/WhatsappDevSyncScreen'

type Props = {
  tenantId: string
  section: ClinicaSection
  entityId?: string
}

export function ClinicArea({ tenantId, section, entityId }: Props) {
  const { api } = useAuthSession()
  const { generation, active } = useTenant()
  const { snap, error, loading, reload } = useClinicConfig(api, tenantId, generation)
  const clinicName =
    active.phase === 'ready' ? active.context.name : tenantId

  if (section === 'whatsapp-dev-sync') {
    if (!api) return <LoadingState label="A carregar…" />
    return (
      <WhatsappDevSyncScreen tenantId={tenantId} api={api} generation={generation} />
    )
  }

  if (
    section === 'whatsapp'
    || section === 'whatsapp-trocar'
    || section === 'whatsapp-desconectar'
  ) {
    if (!api) return <LoadingState label="A carregar WhatsApp…" />
    const mode =
      section === 'whatsapp-trocar'
        ? 'trocar'
        : section === 'whatsapp-desconectar'
          ? 'desconectar'
          : 'main'
    return (
      <WhatsappScreen
        tenantId={tenantId}
        api={api}
        generation={generation}
        mode={mode}
        clinicName={clinicName}
      />
    )
  }

  if (section === 'recebimento') {
    if (!api) return <LoadingState label="A carregar recebimento…" />
    return (
      <RecebimentoScreen
        tenantId={tenantId}
        api={api}
        generation={generation}
      />
    )
  }

  if (loading && !snap) {
    return <LoadingState label="A carregar configuração da clínica…" />
  }
  if (error && !snap) {
    return (
      <ErrorState
        title="Não foi possível carregar a clínica"
        description={error}
        actionLabel="Tentar de novo"
        onAction={() => void reload()}
      />
    )
  }
  if (!snap || !api) {
    return <LoadingState label="A carregar configuração da clínica…" />
  }

  switch (section) {
    case 'hub':
      return <ClinicHub tenantId={tenantId} snap={snap} />
    case 'servicos':
      return <ServicesList tenantId={tenantId} snap={snap} />
    case 'servico':
      return (
        <ServiceForm
          tenantId={tenantId}
          entityId={entityId ?? 'novo'}
          snap={snap}
          api={api}
          generation={generation}
          onSaved={reload}
        />
      )
    case 'recursos':
      return <ResourcesList tenantId={tenantId} snap={snap} />
    case 'profissional':
      return (
        <ResourceForm
          tenantId={tenantId}
          kind="professional"
          entityId={entityId ?? 'novo'}
          snap={snap}
          api={api}
          generation={generation}
          onSaved={reload}
        />
      )
    case 'sala':
      return (
        <ResourceForm
          tenantId={tenantId}
          kind="room"
          entityId={entityId ?? 'novo'}
          snap={snap}
          api={api}
          generation={generation}
          onSaved={reload}
        />
      )
    case 'horarios':
      return (
        <SchedulesScreen
          tenantId={tenantId}
          snap={snap}
          api={api}
          generation={generation}
          onSaved={reload}
        />
      )
  }
}
