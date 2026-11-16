import { useEffect, useState } from 'react'
import type { AdminTenantRow } from '../api'
import { AdminLoadError, AdminLoading, PageHeader, Pill } from '../AdminUi'
import { SITUATION_LABEL, SITUATION_TONE, healthReasons, tenantDisplayState, formatReading } from '../format'
import { clinicaHref, navigateAdmin } from '../routes'
import { useAdminApi } from '../useAdminApi'
import { summaryIsStale, useHealthOverview } from './useHealthOverview'

/** PA-01 — contadores por estado e clínicas que precisam de atenção. Suporte e atividade chegam em #831/#832. */
export function VisaoGeral() {
  const api = useAdminApi()
  const { load, reload } = useHealthOverview()
  const [rows, setRows] = useState<AdminTenantRow[] | null>(null)
  const [rowsError, setRowsError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setRowsError(false)
    api
      .listTenants({ signal: controller.signal })
      .then((r) => {
        if (!controller.signal.aborted) setRows(r)
      })
      .catch(() => {
        if (!controller.signal.aborted) setRowsError(true)
      })
    return () => controller.abort()
  }, [api, attempt])

  if (rowsError || load.phase === 'error') {
    return <AdminLoadError what="a visão geral" onRetry={() => {
          reload()
          setAttempt((n) => n + 1)
        }} />
  }
  if (load.phase === 'loading' || rows === null) return <AdminLoading label="Carregando a visão geral…" />

  const { overview } = load
  const count = (s: string) => rows.filter((r) => tenantDisplayState(r) === s).length
  const needAttention = overview.clinics.filter(
    (c) => c.tenantStatus === 'active' && (c.situation === 'critical' || c.situation === 'attention'),
  )
  const go = (href: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigateAdmin(href)
  }

  return (
    <>
      <PageHeader
        title="Visão geral"
        sub={overview.summaryAt ? `Resumo das ${formatReading(overview.summaryAt)}` : 'Ainda sem leituras de saúde'}
        actions={<button type="button" className="admin-btn" onClick={reload}>Recarregar</button>}
      />
      {summaryIsStale(overview) ? (
        <div className="admin-note admin-note--warn" role="status">
          <span>O resumo de saúde está desatualizado: a leitura periódica pode estar parada.</span>
        </div>
      ) : null}
      <div className="admin-stats">
        <a className="admin-card admin-stat" href="/admin/clinicas" onClick={go('/admin/clinicas')}><b>{count('active')}</b><span>Clínicas ativas</span></a>
        <a className="admin-card admin-stat" href="/admin/clinicas" onClick={go('/admin/clinicas')}><b>{count('onboarding')}</b><span>Em configuração</span></a>
        <a className="admin-card admin-stat" href="/admin/clinicas" onClick={go('/admin/clinicas')}><b>{count('suspended')}</b><span>Suspensas</span></a>
        <a className="admin-card admin-stat" href="/admin/clinicas" onClick={go('/admin/clinicas')}><b>{count('pending_deletion')}</b><span>Exclusão pendente</span></a>
      </div>
      <div className="admin-grid">
        <section className="admin-card admin-card--wide" aria-labelledby="adm-attn">
          <h2 id="adm-attn" className="admin-card-title">Clínicas que precisam de atenção</h2>
          {needAttention.length === 0 ? (
            <p className="admin-muted">Nenhuma clínica ativa com sinais de problema no último resumo.</p>
          ) : (
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Clínica</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Sinais</th>
                  </tr>
                </thead>
                <tbody>
                  {needAttention.map((c) => {
                    const href = clinicaHref(c.tenantId, 'saude')
                    return (
                      <tr key={c.tenantId}>
                        <th scope="row"><a href={href} onClick={go(href)}>{c.name}</a></th>
                        <td><Pill tone={SITUATION_TONE[c.situation]}>{SITUATION_LABEL[c.situation]}</Pill></td>
                        <td>{healthReasons(c).join(' · ') || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <a href="/admin/saude" onClick={go('/admin/saude')}>Ver a saúde de todas as clínicas</a>
        </section>
        <section className="admin-card" aria-labelledby="adm-sup">
          <h2 id="adm-sup" className="admin-card-title">Suporte</h2>
          <p className="admin-muted">Pedidos e sessões de suporte chegam com a issue #831 do épico #827.</p>
        </section>
        <section className="admin-card" aria-labelledby="adm-act">
          <h2 id="adm-act" className="admin-card-title">Atividade recente da plataforma</h2>
          <p className="admin-muted">A auditoria entre clínicas chega com a issue #832 do épico #827.</p>
        </section>
      </div>
    </>
  )
}
