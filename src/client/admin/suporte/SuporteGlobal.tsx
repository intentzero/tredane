import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../../panel/states/StatusScreens'
import type { AdminTenantRow } from '../api'
import { AdminLoadError, AdminLoading, PageHeader } from '../AdminUi'
import { SUPPORT_OPEN, formatSpan, personLabel } from '../format'
import { useAdminApi } from '../useAdminApi'
import { RequestSupportDialog } from './RequestSupportDialog'
import { SupportTable } from './SupportTable'
import { useSupport } from './useSupport'

type Filter = 'all' | 'open' | 'closed'

/** Nota sobre o que ainda não existe: sem botões que prometem o que o servidor não faz em produção. */
export const SUPPORT_SCOPE_NOTE =
  'Esta página mostra os pedidos e sessões. Ativar, entrar e encerrar uma sessão ainda não estão disponíveis na Platform Admin.'

/** PA-05 — pedidos e sessões de suporte de todas as clínicas (DEC-029 a DEC-037). */
export function SuporteGlobal() {
  const api = useAdminApi()
  const { load, reload } = useSupport()
  const [filter, setFilter] = useState<Filter>('all')
  const [clinics, setClinics] = useState<AdminTenantRow[]>([])
  const [dialog, setDialog] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api
      .listTenants({ signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) setClinics(rows.filter((r) => r.status === 'active' && r.ownerCount > 0))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [api])

  const items = load.phase === 'ready' ? load.items : []
  const open = useMemo(() => items.filter((i) => SUPPORT_OPEN.includes(i.state)), [items])
  const closed = useMemo(() => items.filter((i) => !SUPPORT_OPEN.includes(i.state)), [items])
  const visible = filter === 'open' ? open : filter === 'closed' ? closed : items
  const active = items.filter((i) => i.state === 'active')

  if (load.phase === 'loading') return <AdminLoading label="Carregando o suporte…" />
  if (load.phase === 'error') return <AdminLoadError what="o suporte" onRetry={reload} />

  return (
    <>
      <PageHeader
        title="Suporte"
        sub="Pedidos e sessões de todas as clínicas · sem acesso antes da aprovação da owner"
        actions={
          <button type="button" className="admin-btn admin-btn--primary" onClick={() => setDialog(true)}>
            Pedir suporte
          </button>
        }
      />
      {notice ? <p className="admin-muted" role="status">{notice}</p> : null}
      {active.map((i) => (
        <section key={i.requestId} className="admin-card admin-session" aria-label={`Sessão ativa · ${i.tenantName}`}>
          <strong>Sessão ativa · {i.tenantName}</strong>
          <span>
            Em nome de {personLabel(i.subject)} · aprovada por {personLabel(i.decider)} · motivo «{i.reason}»
          </span>
          <span className="admin-muted">
            {i.remainingMs !== null ? `Restam ${formatSpan(i.remainingMs)} de 30 minutos` : ''}. A sessão não se prolonga:
            para continuar depois, faça um novo pedido.
          </span>
        </section>
      ))}
      {items.length === 0 ? (
        <EmptyState
          title="Ainda não há pedidos de suporte"
          description="Quando pedir acesso a uma clínica, o pedido aparece aqui com o estado."
        />
      ) : (
        <>
          <div className="admin-toolbar">
            <div className="admin-seg" role="group" aria-label="Filtro">
              {(
                [
                  ['all', `Todos ${items.length}`],
                  ['open', `Abertos ${open.length}`],
                  ['closed', `Encerrados ${closed.length}`],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {visible.length === 0 ? (
            <EmptyState title="Nenhum pedido neste filtro" description="Mude o filtro para ver os outros." />
          ) : (
            <SupportTable items={visible} showClinic />
          )}
        </>
      )}
      <span className="admin-muted">{SUPPORT_SCOPE_NOTE}</span>
      <RequestSupportDialog
        open={dialog}
        clinics={clinics}
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
