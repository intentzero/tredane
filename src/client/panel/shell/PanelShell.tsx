import { Bell } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from 'react-aria-components'
import { AccountControl } from '../auth/ClerkBridge'
import { useAuthSession } from '../auth/AuthContext'
import type { PanelArea } from '../routes'
import { areaTitle, navigatePanel } from '../routes'
import {
  AccessEndedState,
  ErrorState,
  ForbiddenState,
  LoadingState,
} from '../states/StatusScreens'
import { useTenant } from '../tenant/TenantContext'
import { WhatsappInterruptBanner } from '../screens/clinic/whatsapp/WhatsappScreen'
import { useWhatsapp } from '../screens/clinic/whatsapp/useWhatsapp'
import { BottomNav } from './BottomNav'
import { ClinicSwitcher } from './ClinicSwitcher'
import { OfflineStrip } from '../states/OfflineStrip'
import { BrandMark } from '../ui/Brand'
import { useKeyboardViewport } from '../ui/useKeyboardViewport'

type Props = {
  area: PanelArea
  tenantId: string
  children: ReactNode
  /** M-14 avisos — sem barra inferior. */
  hideNav?: boolean
  /** Conversa aberta: no celular fica em tela cheia, sem barra inferior (ux-ui.md). */
  immersiveOnPhone?: boolean
}

export function PanelShell({ area, tenantId, children, hideNav, immersiveOnPhone }: Props) {
  const { active, selectTenant, listState, generation } = useTenant()
  const { api } = useAuthSession()
  const { conn: waConn } = useWhatsapp(api, tenantId, generation)
  const [offline, setOffline] = useState(!navigator.onLine)
  useKeyboardViewport()

  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const readyContext = active.phase === 'ready' ? active.context : null
  const tenantMismatch = Boolean(readyContext && readyContext.tenantId !== tenantId)

  useEffect(() => {
    if (tenantMismatch) void selectTenant(tenantId)
  }, [tenantMismatch, tenantId, selectTenant])

  if (active.phase === 'none' || active.phase === 'switching' || tenantMismatch) {
    const hint = active.phase === 'switching' ? active.nameHint : undefined
    return (
      <LoadingState
        label={
          tenantMismatch
            ? 'Atualizando a clínica…'
            : hint
              ? `Abrindo ${hint}…`
              : 'Abrindo clínica…'
        }
      />
    )
  }

  if (active.phase === 'forbidden') {
    return (
      <ForbiddenState
        title="Você não tem acesso a esta área"
        description="Esta clínica não está disponível na sua conta, ou o acesso foi revogado."
        actionLabel="Escolher clínica"
        onAction={() => navigatePanel({ kind: 'clinicas' }, true)}
      />
    )
  }

  if (active.phase === 'ended') {
    return (
      <AccessEndedState
        title="Acesso encerrado"
        description="Esta clínica foi suspensa ou o seu acesso terminou. Os dados deixaram de ser apresentados."
        actionLabel="Escolher clínica"
        onAction={() => navigatePanel({ kind: 'clinicas' }, true)}
      />
    )
  }

  if (active.phase === 'error') {
    return (
      <ErrorState
        title="Falha ao abrir a clínica"
        description={active.message}
        actionLabel="Tentar de novo"
        onAction={() => void selectTenant(tenantId)}
      />
    )
  }

  const ctx = active.context
  const isOwner = ctx.role === 'owner'

  if (area === 'clinica' && !isOwner) {
    return (
      <div className="panel-app" lang="pt-BR">
        <ForbiddenState
          title="Você não tem acesso a esta área"
          description="A configuração da clínica é só para o responsável. Nenhum dado foi carregado."
          actionLabel="Ir para Conversas"
          onAction={() =>
            navigatePanel(
              {
                kind: 'area',
                area: 'conversas',
                tenantId: ctx.tenantId,
                section: 'lista',
              },
              true,
            )
          }
        />
      </div>
    )
  }

  const avisosOnly = hideNav || area === 'avisos'

  return (
    <div
      className={`panel-app${immersiveOnPhone ? ' panel-app--immersive' : ''}`}
      lang="pt-BR"
    >
      <a className="panel-skip-link" href="#panel-main">
        Saltar para o conteúdo
      </a>
      {!avisosOnly ? (
        <header className="panel-shell-header">
          <div className="panel-shell-lead">
            <BrandMark size={32} />
          <div className="panel-shell-titles">
            <h1 className="panel-title-lg">{areaTitle(area)}</h1>
            <div className="panel-shell-clinic">
              <ClinicSwitcher
                tenantId={ctx.tenantId}
                name={ctx.name}
                area={area}
                tenants={listState.phase === 'ready' ? listState.tenants : []}
              />
              <span
                className={`panel-live${offline ? ' panel-live--offline' : ''}`}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <span className="panel-live-dot" aria-hidden="true" />
                {offline ? 'Sem conexão' : 'Ao vivo'}
              </span>
            </div>
          </div>
          </div>
          <div className="panel-shell-actions">
            <Button
              className="panel-icon-btn"
              aria-label="Avisos no celular"
              onPress={() =>
                navigatePanel({ kind: 'area', area: 'avisos', tenantId: ctx.tenantId })
              }
            >
              <Bell aria-hidden="true" size={20} strokeWidth={2} />
            </Button>
            <AccountControl />
          </div>
        </header>
      ) : null}

      {offline ? (
        <OfflineStrip />
      ) : null}

      {!avisosOnly ? (
        <WhatsappInterruptBanner
          tenantId={ctx.tenantId}
          conn={waConn}
          isOwner={isOwner}
        />
      ) : null}

      <main
        id="panel-main"
        tabIndex={-1}
        className={`panel-shell-main${avisosOnly ? ' panel-shell-main--flush' : ''}`}
      >
        {children}
      </main>

      {!avisosOnly ? (
        <BottomNav tenantId={ctx.tenantId} active={area} showClinica={isOwner} />
      ) : null}
    </div>
  )
}
