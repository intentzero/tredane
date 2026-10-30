import { useAuthSession } from '../../auth/AuthContext'
import { useTenant } from '../../tenant/TenantContext'
import { ListSkeleton } from '../../states/ListSkeleton'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import type { ReactNode } from 'react'
import { navigatePanel, type ClinicaSection } from '../../routes'
import { AiAssistCard } from './AiAssistCard'
import { ForecastPlaceCard } from './ForecastPlaceCard'
import { AutomationLimitsCard } from './AutomationLimitsCard'
import { StagingResetCard } from './StagingResetCard'
import { isStagingHostname } from './whatsapp/WhatsappDevSyncAction'
import { ClinicHub } from './ClinicHub'
import { ClinicContext } from './ClinicContext'
import { ClinicPanel } from './ClinicPanel'
import { useMediaQuery } from '../../ui/useMediaQuery'
import { ResourceForm, ResourcesList } from './ResourcesScreen'
import { ClinicHoursScreen } from './ClinicHoursScreen'
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
  const wide = useMediaQuery('(min-width: 1280px)')
  const clinicName = active.phase === 'ready' ? active.context.name : tenantId
  const isOwner = active.phase === 'ready' && active.context.role === 'owner'

  if (section === 'whatsapp-dev-sync') {
    if (!api) return <LoadingState label="Carregando…" />
    return <WhatsappDevSyncScreen tenantId={tenantId} api={api} generation={generation} />
  }

  if (
    section === 'whatsapp' ||
    section === 'whatsapp-trocar' ||
    section === 'whatsapp-historico' ||
    section === 'whatsapp-desconectar'
  ) {
    if (!api) return <LoadingState label="Carregando WhatsApp…" />
    const mode =
      section === 'whatsapp-trocar'
        ? 'trocar'
        : section === 'whatsapp-desconectar'
          ? 'desconectar'
          : section === 'whatsapp-historico'
            ? 'historico'
            : 'main'
    return (
      <WhatsappScreen
        tenantId={tenantId}
        api={api}
        generation={generation}
        mode={mode}
        clinicName={clinicName}
        isOwner={isOwner}
      />
    )
  }

  if (section === 'recebimento') {
    if (!api) return <LoadingState label="Carregando recebimento…" />
    return <RecebimentoScreen tenantId={tenantId} api={api} generation={generation} />
  }

  if (loading && !snap) {
    return <ListSkeleton label="Carregando configuração da clínica…" rows={5} />
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
    return <ListSkeleton label="Carregando configuração da clínica…" rows={5} />
  }

  // Desktop: a edição de serviço, profissional ou sala abre por cima da lista (DEC-069).
  let panel: ReactNode = null
  const overList = (title: string, to: ClinicaSection, form: ReactNode, listEntityId?: string) => {
    panel = (
      <ClinicPanel
        key={`${section}:${entityId ?? 'novo'}`}
        title={title}
        onClose={() =>
          navigatePanel({
            kind: 'area',
            area: 'clinica',
            tenantId,
            section: to,
            ...(listEntityId ? { entityId: listEntityId } : {}),
          })
        }
      >
        {form}
      </ClinicPanel>
    )
  }

  const body = (() => {
    switch (section) {
      case 'hub':
        return (
          <ClinicHub
            tenantId={tenantId}
            snap={snap}
            aiCard={
              <>
                {isOwner ? (
                  <ForecastPlaceCard
                    tenantId={tenantId}
                    api={api}
                    generation={generation}
                    place={{
                      mode: snap.settings.forecastMode,
                      city: snap.settings.forecastCity,
                      latitude: snap.settings.forecastLatitude,
                      longitude: snap.settings.forecastLongitude,
                    }}
                    onSaved={() => void reload()}
                  />
                ) : null}
                <AiAssistCard
                  tenantId={tenantId}
                  api={api}
                  generation={generation}
                  initialEnabled={snap.settings.aiAssistEnabled === true}
                  initialAddress={snap.settings.clinicAddress ?? null}
                  initialGoogleBusinessUrl={snap.settings.googleBusinessUrl ?? null}
                  initialReschedulePolicy={snap.settings.reschedulePolicy ?? null}
                />
                {isOwner ? (
                  <AutomationLimitsCard
                    tenantId={tenantId}
                    api={api}
                    generation={generation}
                  />
                ) : null}
              </>
            }
            stagingCard={
              isOwner && isStagingHostname() && active.phase === 'ready' ? (
                <StagingResetCard
                  tenantId={tenantId}
                  clinicName={active.context.name}
                  api={api}
                  generation={generation}
                  onDone={() => void reload()}
                />
              ) : null
            }
          />
        )
      case 'servicos':
        return <ServicesList tenantId={tenantId} snap={snap} />
      case 'servico': {
        const form = (
          <ServiceForm
            tenantId={tenantId}
            entityId={entityId ?? 'novo'}
            snap={snap}
            api={api}
            generation={generation}
            onSaved={reload}
          />
        )
        if (!wide) return form
        overList('Serviço', 'servicos', form)
        return <ServicesList tenantId={tenantId} snap={snap} />
      }
      case 'recursos':
        return (
          <ResourcesList
            key={entityId === 'salas' ? 'room' : 'professional'}
            tenantId={tenantId}
            snap={snap}
            tab={entityId === 'salas' ? 'room' : 'professional'}
          />
        )
      case 'profissional': {
        const form = (
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
        if (!wide) return form
        overList('Profissional', 'recursos', form)
        return <ResourcesList key="professional" tenantId={tenantId} snap={snap} tab="professional" />
      }
      case 'sala': {
        const form = (
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
        if (!wide) return form
        overList('Sala', 'recursos', form, 'salas')
        return <ResourcesList key="room" tenantId={tenantId} snap={snap} tab="room" />
      }
      case 'horarios':
        return (
          <ClinicHoursScreen
            tenantId={tenantId}
            snap={snap}
            api={api}
            generation={generation}
            onSaved={reload}
          />
        )
    }
  })()

  if (!wide) return body
  return (
    <div className="clinic-wide">
      <ClinicContext tenantId={tenantId} section={section} entityId={entityId} snap={snap} />
      <div className="clinic-work">{body}</div>
      {panel}
    </div>
  )
}
