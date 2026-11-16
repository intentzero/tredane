import { useState } from 'react'
import type { AdminTenantStatus } from '../api'
import { AdminLoadError, AdminLoading } from '../AdminUi'
import { SUPPORT_OPEN, formatSpan, personLabel } from '../format'
import { EmptyState } from '../../panel/states/StatusScreens'
import { RequestSupportDialog } from './RequestSupportDialog'
import { SUPPORT_SCOPE_NOTE } from './SuporteGlobal'
import { SupportTable } from './SupportTable'
import { useSupport } from './useSupport'

type Props = { tenantId: string; tenantName: string; tenantStatus: AdminTenantStatus; hasActiveOwner: boolean }

/** Aba Suporte da clínica (PA-10): histórico de pedidos e sessões só desta clínica. */
export function SuporteTab({ tenantId, tenantName, tenantStatus, hasActiveOwner }: Props) {
  const { load, reload } = useSupport(tenantId)
  const [dialog, setDialog] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  if (load.phase === 'loading') return <AdminLoading label="Carregando o suporte…" />
  if (load.phase === 'error') return <AdminLoadError what="o suporte" onRetry={reload} />
  const items = load.items
  const active = items.find((i) => i.state === 'active')
  const open = items.filter((i) => SUPPORT_OPEN.includes(i.state)).length
  const canRequest = tenantStatus === 'active' && hasActiveOwner

  return (
    <>
      <div className="admin-toolbar">
        <span className="admin-muted admin-toolbar-spacer">
          {active
            ? `Sessão ativa agora · restam ${formatSpan(active.remainingMs ?? 0)}`
            : open > 0
              ? `${open} pedido(s) em aberto`
              : 'Pedidos e sessões só desta clínica · sem sessão ativa agora'}
        </span>
        {canRequest ? (
          <button type="button" className="admin-btn admin-btn--primary" onClick={() => setDialog(true)}>
            Pedir suporte
          </button>
        ) : null}
      </div>
      {!canRequest ? (
        <div className="admin-note admin-note--warn" role="status">
          <span>
            {tenantStatus !== 'active'
              ? 'A clínica não está ativa: não se pode pedir suporte.'
              : 'Esta clínica ainda não tem owner ativa: ninguém pode aprovar o acesso.'}
          </span>
        </div>
      ) : null}
      {notice ? <p className="admin-muted" role="status">{notice}</p> : null}
      {active ? (
        <section className="admin-card admin-session" aria-label="Sessão ativa">
          <strong>Sessão ativa</strong>
          <span>
            Em nome de {personLabel(active.subject)} · aprovada por {personLabel(active.decider)} · motivo «
            {active.reason}»
          </span>
        </section>
      ) : null}
      {items.length === 0 ? (
        <EmptyState title="Sem pedidos de suporte" description={`Ainda não houve pedidos de suporte para ${tenantName}.`} />
      ) : (
        <SupportTable items={items} showClinic={false} />
      )}
      <span className="admin-muted">
        Cada sessão dura no máximo 30 minutos e precisa de aprovação de uma owner ativa (DEC-029, DEC-032).{' '}
        {SUPPORT_SCOPE_NOTE}
      </span>
      <RequestSupportDialog
        open={dialog}
        tenant={{ id: tenantId, name: tenantName }}
        onClose={() => setDialog(false)}
        onCreated={(message) => {
          setDialog(false)
          setNotice(message)
          reload()
        }}
      />
    </>
  )
}
