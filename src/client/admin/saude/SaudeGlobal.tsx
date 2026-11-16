import { EmptyState } from '../../panel/states/StatusScreens'
import { AdminLoadError, AdminLoading, PageHeader, Pill } from '../AdminUi'
import { CHANNEL_LABEL, CHANNEL_TONE, SITUATION_LABEL, SITUATION_TONE, formatReading } from '../format'
import { clinicaHref, navigateAdmin } from '../routes'
import { summaryIsStale, useHealthOverview } from './useHealthOverview'

const cell = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(v))

/** PA-06 — saúde de todas as clínicas, lida do resumo periódico (DEC-193). */
export function SaudeGlobal() {
  const { load, reload } = useHealthOverview()
  if (load.phase === 'loading') return <AdminLoading label="Carregando a saúde…" />
  if (load.phase === 'error') return <AdminLoadError what="a saúde" onRetry={reload} />
  const { overview } = load
  const { totals } = overview
  const stale = summaryIsStale(overview)

  return (
    <>
      <PageHeader
        title="Saúde"
        sub={
          overview.summaryAt
            ? `Só contagens e estados · resumo das ${formatReading(overview.summaryAt)} · atualiza a cada ${Math.round(overview.refreshIntervalMs / 60_000)} min`
            : 'Só contagens e estados · ainda sem leituras'
        }
        actions={
          <button type="button" className="admin-btn" onClick={reload}>
            Recarregar
          </button>
        }
      />
      {stale ? (
        <div className="admin-note admin-note--warn" role="status">
          <span>
            {overview.summaryAt
              ? 'O resumo tem mais de 20 minutos: a leitura periódica pode estar parada.'
              : 'Ainda não há nenhum resumo: a leitura periódica ainda não correu.'}
          </span>
        </div>
      ) : null}
      <div className="admin-stats">
        <div className="admin-card admin-stat"><b>{totals.critical}</b><span>Crítico</span></div>
        <div className="admin-card admin-stat"><b>{totals.attention}</b><span>Atenção</span></div>
        <div className="admin-card admin-stat"><b>{totals.llmJobsOpen}</b><span>Jobs de IA na fila (todas)</span></div>
        <div className="admin-card admin-stat"><b>{totals.unreachable}</b><span>Clínicas sem resposta</span></div>
      </div>
      {overview.clinics.length === 0 ? (
        <EmptyState title="Ainda não há clínicas" description="A saúde aparece aqui quando houver clínicas." />
      ) : (
        <div className="admin-card admin-card--flush">
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Clínica</th>
                  <th scope="col">Situação</th>
                  <th scope="col">WhatsApp</th>
                  <th scope="col" className="admin-num">Outbox pend.</th>
                  <th scope="col" className="admin-num">Outbox falh.</th>
                  <th scope="col" className="admin-num">Incertos</th>
                  <th scope="col" className="admin-num">IA na fila</th>
                  <th scope="col" className="admin-num">IA falh. 1 h</th>
                  <th scope="col">Schema</th>
                  <th scope="col">Leitura</th>
                </tr>
              </thead>
              <tbody>
                {overview.clinics.map((c) => {
                  const href = clinicaHref(c.tenantId, 'saude')
                  const n = c.counts
                  return (
                    <tr key={c.tenantId}>
                      <th scope="row">
                        <a
                          href={href}
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                            e.preventDefault()
                            navigateAdmin(href)
                          }}
                        >
                          {c.name}
                        </a>
                      </th>
                      <td><Pill tone={SITUATION_TONE[c.situation]}>{SITUATION_LABEL[c.situation]}</Pill></td>
                      <td>
                        <Pill tone={CHANNEL_TONE[c.whatsapp.status]}>{CHANNEL_LABEL[c.whatsapp.status]}</Pill>
                      </td>
                      <td className="admin-num">{cell(n?.pendingOutbox)}</td>
                      <td className="admin-num">{cell(n?.failedOutbox)}</td>
                      <td className="admin-num">{cell(n?.uncertainOutbound)}</td>
                      <td className="admin-num">{cell(n?.llmJobsOpen)}</td>
                      <td className="admin-num">{cell(n?.llmJobsFailed1h)}</td>
                      <td>{n?.schemaVersion != null ? `v${n.schemaVersion}` : '—'}</td>
                      <td>
                        {c.readAt === null ? (
                          <span className="admin-muted">nunca lida</span>
                        ) : (
                          <>
                            {formatReading(c.readAt)}
                            {c.stale ? <span className="admin-muted admin-block">sem resposta</span> : null}
                            {c.tenantStatus !== 'active' ? (
                              <span className="admin-muted admin-block">
                                {c.tenantStatus === 'suspended' ? 'suspensa' : 'exclusão pendente'}
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <span className="admin-muted">
        Situação e limiares são <strong>propostos</strong> (src/ops/alerts.ts) e ainda não são SLOs. Uma clínica sem
        resposta mostra a última leitura válida. Clínicas suspensas não são lidas.
      </span>
    </>
  )
}
