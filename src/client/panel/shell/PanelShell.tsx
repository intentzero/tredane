import { ChevronDown } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Button } from 'react-aria-components'
import { SignOutButton } from '../auth/ClerkBridge'
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

type Props = {
  area: PanelArea
  tenantId: string
  children: ReactNode
}

export function PanelShell({ area, tenantId, children }: Props) {
  const { active, selectTenant, listState, generation } = useTenant()
  const { api } = useAuthSession()
  const { conn: waConn } = useWhatsapp(api, tenantId, generation)

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
            ? 'A sincronizar clínica…'
            : hint
              ? `Abrindo ${hint}…`
              : 'A abrir clínica…'
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

  const multi = listState.phase === 'ready' && listState.tenants.length > 1

  return (
    <div className="panel-app" lang="pt-BR">
      <header className="panel-shell-header">
        <div className="panel-shell-titles">
          <h1 className="panel-title-lg">{areaTitle(area)}</h1>
          <div className="panel-shell-clinic">
            {multi ? (
              <Button
                className="panel-clinic-switch"
                onPress={() => navigatePanel({ kind: 'clinicas' })}
                aria-label={`Clínica ativa: ${ctx.name}. Trocar clínica.`}
              >
                <span>{ctx.name}</span>
                <ChevronDown aria-hidden="true" size={16} strokeWidth={2} />
              </Button>
            ) : (
              <span className="panel-subtitle">{ctx.name}</span>
            )}
            <span className="panel-live">
              <span className="panel-live-dot" aria-hidden="true" />
              Ao vivo
            </span>
          </div>
        </div>
        <SignOutButton />
      </header>

      <WhatsappInterruptBanner
        tenantId={ctx.tenantId}
        conn={waConn}
        isOwner={isOwner}
      />

      <main className="panel-shell-main">{children}</main>

      <BottomNav tenantId={ctx.tenantId} active={area} showClinica={isOwner} />
    </div>
  )
}
