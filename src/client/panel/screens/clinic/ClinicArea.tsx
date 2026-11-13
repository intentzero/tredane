import { useAuthSession } from '../../auth/AuthContext'
import { useTenant } from '../../tenant/TenantContext'
import { ErrorState } from '../../states/StatusScreens'
import { useEffect, useState, type ReactNode } from 'react'
import { navigatePanel, type ClinicaSection } from '../../routes'
import { AiAssistCard } from './AiAssistCard'
import { ForecastPlaceCard } from './ForecastPlaceCard'
import { AutomationLimitsCard } from './AutomationLimitsCard'
import { StagingResetCard } from './StagingResetCard'
import { isStagingHostname } from './whatsapp/WhatsappDevSyncAction'
import { ClinicHub } from './ClinicHub'
import { ClinicContext } from './ClinicContext'
import { ClinicPanel } from './ClinicPanel'
import { ConferirScreen } from './ConferirScreen'
import { useMediaQuery } from '../../ui/useMediaQuery'
import { ResourceForm, ResourcesList } from './ResourcesScreen'
import { ClinicHoursScreen } from './ClinicHoursScreen'
import { ServiceForm, ServicesList } from './ServicesScreen'
import { UnmatchedTermsCard } from './UnmatchedTermsCard'
import { useClinicConfig } from './useClinicConfig'
import { WhatsappScreen } from './whatsapp/WhatsappScreen'
import { RecebimentoScreen } from './pix/RecebimentoScreen'
import { WhatsappDevSyncScreen } from './whatsapp/WhatsappDevSyncScreen'
import { EquipeScreen } from './EquipeScreen'
import { ClinicSubScreen } from './ClinicSubHeader'
import { ClinicPageHeader } from './ClinicPageHeader'
import { ClinicSkeleton, type ClinicSkeletonShape } from './ClinicSkeleton'

type Props = {
  tenantId: string
  section: ClinicaSection
  entityId?: string
}

type PageMeta = {
  title: string
  description?: string
  shape: ClinicSkeletonShape
  /** Cabeçalho de página comum (título + frase). Equipe e o início têm o seu. */
  header: boolean
  /** No celular, cabeçalho único de 56 px (DEC-163). */
  mobileSub: boolean
  /** Coluna de 1040 px em vez de 760 px (índice e tabelas). */
  wideColumn?: boolean
}

/** DEC-175: título, frase e forma do esqueleto de cada opção da Clínica. */
function pageMeta(section: ClinicaSection, entityId?: string): PageMeta {
  switch (section) {
    case 'hub':
      return { title: 'Clínica', shape: 'index', header: false, mobileSub: false, wideColumn: true }
    case 'conferir':
      return {
        title: 'Conferir',
        description: 'Quem faz, onde e o próximo horário de cada serviço. Só leitura; corrija na ficha.',
        shape: 'table',
        header: true,
        mobileSub: true,
        wideColumn: true,
      }
    case 'horarios':
      return {
        title: 'Horário',
        description: 'Quando a clínica atende e os dias de exceção.',
        shape: 'week',
        header: true,
        mobileSub: true,
      }
    case 'recursos':
    case 'profissional':
    case 'sala': {
      const rooms = section === 'sala' || (section === 'recursos' && entityId === 'salas')
      return rooms
        ? {
            title: 'Salas e equipamentos',
            description: 'Onde os serviços acontecem.',
            shape: 'list',
            header: true,
            mobileSub: section === 'recursos',
          }
        : {
            title: 'Profissionais',
            description: 'Quem atende na clínica.',
            shape: 'list',
            header: true,
            mobileSub: section === 'recursos',
          }
    }
    case 'servicos':
    case 'servico':
      return {
        title: 'Serviços',
        description: 'O que a clínica oferece, quanto dura e quanto custa.',
        shape: 'table',
        header: true,
        mobileSub: section === 'servicos',
      }
    case 'assistente':
      return {
        title: 'Assistente e automações',
        description: 'O que o assistente faz nas conversas e os limites das automações.',
        shape: 'cards',
        header: true,
        mobileSub: true,
      }
    case 'whatsapp':
    case 'whatsapp-trocar':
    case 'whatsapp-historico':
    case 'whatsapp-desconectar':
      return {
        title: 'WhatsApp',
        description: 'O número por onde as clientes falam com a clínica.',
        shape: 'connection',
        header: section === 'whatsapp',
        mobileSub: section === 'whatsapp',
      }
    case 'whatsapp-dev-sync':
      return { title: 'WhatsApp de teste', shape: 'connection', header: false, mobileSub: false }
    case 'recebimento':
      return {
        title: 'Recebimento de sinais',
        description:
          'O Pix do sinal cai na conta da clínica, pela Woovi. O Tredane cria a cobrança e não recebe nem repassa o dinheiro.',
        shape: 'form',
        header: true,
        mobileSub: true,
      }
    case 'equipe':
      return { title: 'Equipe', shape: 'list', header: false, mobileSub: true }
  }
}

export function ClinicArea({ tenantId, section, entityId }: Props) {
  const { api } = useAuthSession()
  const { generation, active } = useTenant()
  const { snap, error, loading, reload } = useClinicConfig(api, tenantId, generation)
  const wide = useMediaQuery('(min-width: 1280px)')
  const clinicName = active.phase === 'ready' ? active.context.name : tenantId
  const isOwner = active.phase === 'ready' && active.context.role === 'owner'
  // null = ainda a perguntar; a Equipe espera por isto para não acrescentar «(você)» depois.
  const [viewer, setViewer] = useState<{ id: string | null } | null>(null)

  useEffect(() => {
    if (!api || section !== 'equipe') return
    let cancelled = false
    setViewer(null)
    void api
      .getMe({ generation, expectGeneration: () => generation })
      .then((me) => {
        if (!cancelled) setViewer({ id: me.clerkUserId })
      })
      .catch(() => {
        if (!cancelled) setViewer({ id: null })
      })
    return () => {
      cancelled = true
    }
  }, [api, section, generation])

  const meta = pageMeta(section, entityId)

  // DEC-175: título e frase comuns; coluna centrada no desktop.
  const page = (node: ReactNode, header = meta.header) => (
    <div className={`clinic-page${meta.wideColumn ? ' clinic-page--wide' : ''}`}>
      {header ? <ClinicPageHeader title={meta.title} description={meta.description} /> : null}
      {node}
    </div>
  )

  // DEC-175: no desktop toda opção abre dentro da moldura (navegação lateral), mesmo a carregar.
  // No celular, cabeçalho único nas telas internas (DEC-163).
  const frame = (node: ReactNode, panel: ReactNode = null) =>
    wide ? (
      <div className="clinic-wide">
        <ClinicContext
          tenantId={tenantId}
          section={section}
          entityId={entityId}
          snap={snap ?? undefined}
        />
        <div className="clinic-work">{node}</div>
        {panel}
      </div>
    ) : meta.mobileSub ? (
      <ClinicSubScreen tenantId={tenantId} title={meta.title}>
        {node}
      </ClinicSubScreen>
    ) : (
      node
    )

  const skeleton = (shape: ClinicSkeletonShape = meta.shape) =>
    frame(page(<ClinicSkeleton shape={shape} label={`Carregando ${meta.title}`} />))

  if (!api) return skeleton()

  if (section === 'equipe') {
    return frame(
      page(
        <EquipeScreen
          tenantId={tenantId}
          api={api}
          generation={generation}
          viewerClerkUserId={viewer?.id ?? null}
          viewerPending={viewer === null}
        />,
      ),
    )
  }

  if (section === 'whatsapp-dev-sync') {
    return frame(page(<WhatsappDevSyncScreen tenantId={tenantId} api={api} generation={generation} />))
  }

  if (
    section === 'whatsapp' ||
    section === 'whatsapp-trocar' ||
    section === 'whatsapp-historico' ||
    section === 'whatsapp-desconectar'
  ) {
    const mode =
      section === 'whatsapp-trocar'
        ? 'trocar'
        : section === 'whatsapp-desconectar'
          ? 'desconectar'
          : section === 'whatsapp-historico'
            ? 'historico'
            : 'main'
    return frame(
      page(
        <WhatsappScreen
          tenantId={tenantId}
          api={api}
          generation={generation}
          mode={mode}
          clinicName={clinicName}
          isOwner={isOwner}
        />,
      ),
    )
  }

  if (section === 'recebimento') {
    return frame(page(<RecebimentoScreen tenantId={tenantId} api={api} generation={generation} />))
  }

  if (section === 'conferir') {
    return frame(page(<ConferirScreen tenantId={tenantId} api={api} generation={generation} />))
  }

  if (loading && !snap) return skeleton()
  if (error && !snap) {
    return frame(
      page(
        <ErrorState
          title="Não foi possível carregar a clínica"
          description={error}
          actionLabel="Tentar de novo"
          onAction={() => void reload()}
        />,
        false,
      ),
    )
  }
  if (!snap) return skeleton()

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

  // DEC-141 / DEC-042: só a responsável vê e grava as sugestões de sinónimo.
  const termsCard = isOwner ? (
    <UnmatchedTermsCard
      tenantId={tenantId}
      api={api}
      generation={generation}
      services={snap.services}
      onSaved={() => void reload()}
    />
  ) : null

  // Formulários no celular ocupam a tela inteira, com o seu próprio título.
  let bare = false
  const body = (() => {
    switch (section) {
      case 'hub':
        return (
          <ClinicHub
            tenantId={tenantId}
            snap={snap}
            showAssistant={isOwner}
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
      case 'assistente':
        return (
          <div className="clinic-stack">
            {/* DEC-163: primeiro a decisão sobre a IA; a cidade da previsão vai para o fim. */}
            <AiAssistCard
              tenantId={tenantId}
              api={api}
              generation={generation}
              initialEnabled={snap.settings.aiAssistEnabled === true}
              initialAddress={snap.settings.clinicAddress ?? null}
              initialGoogleBusinessUrl={snap.settings.googleBusinessUrl ?? null}
              initialReschedulePolicy={snap.settings.reschedulePolicy ?? null}
              initialVirtualAttendantName={snap.settings.virtualAttendantName ?? null}
              initialVirtualAttendantGender={snap.settings.virtualAttendantGender ?? null}
            />
            {isOwner ? (
              <AutomationLimitsCard tenantId={tenantId} api={api} generation={generation} />
            ) : null}
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
          </div>
        )
      case 'servicos':
        return <ServicesList tenantId={tenantId} snap={snap} suggestions={termsCard} />
      case 'servico': {
        const form = (
          <ServiceForm
            key={entityId ?? 'novo'}
            tenantId={tenantId}
            entityId={entityId ?? 'novo'}
            snap={snap}
            api={api}
            generation={generation}
            onSaved={reload}
          />
        )
        if (!wide) {
          bare = true
          return form
        }
        overList('Serviço', 'servicos', form)
        return <ServicesList tenantId={tenantId} snap={snap} suggestions={termsCard} />
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
        if (!wide) {
          bare = true
          return form
        }
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
        if (!wide) {
          bare = true
          return form
        }
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
      default:
        return null
    }
  })()

  if (bare) return body
  return frame(page(body), panel)
}
