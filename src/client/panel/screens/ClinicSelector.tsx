import { Building2 } from 'lucide-react'
import { useEffect } from 'react'
import { ListBox, ListBoxItem } from 'react-aria-components'
import { SignOutButton } from '../auth/ClerkBridge'
import { navigatePanel } from '../routes'
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../states/StatusScreens'
import { useTenant } from '../tenant/TenantContext'

function roleLabel(role: 'owner' | 'attendant'): string {
  return role === 'owner' ? 'Responsável' : 'Atendente'
}

/**
 * M-10 — escolher clínica. Uma só → redireciona; várias → lista.
 * Login não concede membership (lista vazia = empty).
 */
export function ClinicSelector() {
  const { listState, selectTenant, active } = useTenant()

  useEffect(() => {
    if (listState.phase === 'unauthenticated') {
      navigatePanel({ kind: 'entrar' }, true)
    }
  }, [listState.phase])

  useEffect(() => {
    if (listState.phase !== 'ready') return
    if (listState.tenants.length !== 1) return
    if (active.phase !== 'none') return
    const only = listState.tenants[0]
    if (!only) return
    void selectTenant(only.tenantId, only.name).then((ok) => {
      if (ok) {
        navigatePanel(
          { kind: 'area', area: 'conversas', tenantId: only.tenantId, section: 'lista' },
          true,
        )
      }
    })
  }, [listState, active.phase, selectTenant])

  if (listState.phase === 'loading' || listState.phase === 'idle') {
    return <LoadingState label="A carregar clínicas…" />
  }
  if (listState.phase === 'unauthenticated') {
    return <LoadingState label="A redirecionar…" />
  }
  if (listState.phase === 'error') {
    return (
      <ErrorState
        title="Não foi possível listar clínicas"
        description={listState.message}
        actionLabel="Tentar de novo"
        onAction={() => window.location.reload()}
      />
    )
  }
  if (listState.phase === 'empty') {
    return (
      <div className="panel-auth" lang="pt-BR">
        <EmptyState
          title="Nenhuma clínica"
          description="O seu login está válido, mas ainda não tem membership numa clínica. Peça um convite ao responsável."
        />
        <div className="panel-auth-foot">
          <SignOutButton />
        </div>
      </div>
    )
  }

  const tenants = listState.tenants

  if (tenants.length === 1 && (active.phase === 'none' || active.phase === 'switching')) {
    const only = tenants[0]
    return <LoadingState label={`A abrir ${only?.name ?? 'clínica'}…`} />
  }

  if (active.phase === 'switching') {
    return (
      <LoadingState
        label={`Abrindo ${active.nameHint ?? 'clínica'}…`}
      />
    )
  }

  return (
    <div className="panel-selector" lang="pt-BR">
      <header className="panel-selector-header">
        <h1 className="panel-auth-title">Escolha a clínica</h1>
        <p>
          Você tem acesso a mais de uma. Dá para trocar depois, pelo nome da clínica no topo.
        </p>
      </header>

      <ListBox
        aria-label="Clínicas"
        className="panel-clinic-list"
        selectionMode="single"
        onAction={(key) => {
          const tenant = tenants.find((t) => t.tenantId === String(key))
          if (!tenant) return
          void selectTenant(tenant.tenantId, tenant.name).then((ok) => {
            if (ok) {
              navigatePanel(
                {
                  kind: 'area',
                  area: 'conversas',
                  tenantId: tenant.tenantId,
                  section: 'lista',
                },
                true,
              )
            }
          })
        }}
      >
        {tenants.map((t) => (
          <ListBoxItem
            key={t.tenantId}
            id={t.tenantId}
            className="panel-clinic-item"
            textValue={t.name}
          >
            <span className="panel-clinic-avatar" aria-hidden="true">
              <Building2 size={20} strokeWidth={2} />
            </span>
            <span className="panel-clinic-copy">
              <span className="panel-clinic-name">{t.name}</span>
              <span className="panel-clinic-meta">Sem novidades</span>
            </span>
            <span className="panel-clinic-role">{roleLabel(t.role)}</span>
          </ListBoxItem>
        ))}
      </ListBox>

      <p className="panel-selector-note">
        Ao trocar de clínica, os dados da anterior saem da tela e você só vê as conversas, o
        acompanhamento e a agenda da clínica escolhida.
      </p>

      <div className="panel-auth-foot">
        <SignOutButton />
      </div>
    </div>
  )
}
