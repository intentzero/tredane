import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '../../panel/states/StatusScreens'
import {
  adminErrorMessage,
  type AdminTenantRow,
  type QualityMetrics,
  type SampleItem,
  type ShadowReport,
  type ShadowVerdict,
} from '../api'
import { AdminLoadError, AdminLoading, PageHeader, Pill } from '../AdminUi'
import { SAMPLE_SOURCE_LABEL, SHADOW_FIELD_LABEL, formatReading, formatRate } from '../format'
import { useAdminApi } from '../useAdminApi'
import { SampleDialog } from './SampleDialog'

const PERIODS = [
  { hours: 24, label: '24 h' },
  { hours: 168, label: '7 dias' },
  { hours: 720, label: '30 dias' },
] as const

type Block<T> = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; data: T }

function useBlock<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): [Block<T>, () => void] {
  const [state, setState] = useState<Block<T>>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setState({ phase: 'loading' })
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ phase: 'ready', data })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: 'error' })
      })
    return () => controller.abort()
  }, [...deps, attempt])
  return [state, useCallback(() => setAttempt((n) => n + 1), [])]
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'bad' }) {
  return (
    <div className="admin-card admin-stat">
      <b>{tone === 'bad' ? <Pill tone="bad">{value}</Pill> : value}</b>
      <span>{label}</span>
    </div>
  )
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)} %` : '—')

/** PA-07 — métricas de conversa, sombra do interpretador e amostras de revisão (DEC-159, DEC-193). */
export function QualidadeIA() {
  const api = useAdminApi()
  const [hours, setHours] = useState<number>(168)
  const [tenantId, setTenantId] = useState('')
  const [clinics, setClinics] = useState<AdminTenantRow[]>([])
  const [open, setOpen] = useState<SampleItem | null>(null)
  const [extra, setExtra] = useState<{ items: SampleItem[]; next: number | null; busy: boolean; error: string | null } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api
      .listTenants({ signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) setClinics(rows)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [api])

  const scope = tenantId || undefined
  const [metrics, reloadMetrics] = useBlock<QualityMetrics>(
    (signal) => api.getQualityMetrics({ sinceHours: hours, tenantId: scope }, { signal }),
    [api, hours, tenantId],
  )
  const [shadow, reloadShadow] = useBlock<ShadowReport>(
    (signal) => api.getShadowReport({ sinceHours: hours, tenantId: scope }, { signal }),
    [api, hours, tenantId],
  )
  const [samples, reloadSamples] = useBlock<{ samples: SampleItem[]; nextBefore: number | null }>(
    (signal) => api.listSamples({ tenantId: scope, limit: 20 }, { signal }),
    [api, tenantId],
  )
  useEffect(() => setExtra(null), [tenantId])

  const loadMore = async () => {
    if (samples.phase !== 'ready') return
    const before = extra ? extra.next : samples.data.nextBefore
    if (!before) return
    setExtra((prev) => ({ items: prev?.items ?? [], next: prev?.next ?? before, busy: true, error: null }))
    try {
      const page = await api.listSamples({ tenantId: scope, before, limit: 20 })
      setExtra((prev) => ({ items: [...(prev?.items ?? []), ...page.samples], next: page.nextBefore, busy: false, error: null }))
    } catch (err) {
      setExtra((prev) => ({ items: prev?.items ?? [], next: prev?.next ?? before, busy: false, error: adminErrorMessage(err) }))
    }
  }

  return (
    <>
      <PageHeader
        title="Qualidade IA"
        sub="Métricas agregadas · os mesmos números do Review MCP"
        actions={
          <div className="admin-toolbar">
            <label className="admin-field admin-inline-field">
              <span className="admin-visually-hidden">Clínica</span>
              <select aria-label="Clínica" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                <option value="">Todas as clínicas</option>
                {clinics.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <div className="admin-seg" role="group" aria-label="Período">
              {PERIODS.map((p) => (
                <button key={p.hours} type="button" aria-pressed={hours === p.hours} onClick={() => setHours(p.hours)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {metrics.phase === 'loading' ? <AdminLoading label="Carregando as métricas…" /> : null}
      {metrics.phase === 'error' ? <AdminLoadError what="as métricas" onRetry={reloadMetrics} /> : null}
      {metrics.phase === 'ready' ? (
        <>
          <div className="admin-stats">
            <Stat value={String(metrics.data.attendantCalls.episodesTotal)} label="Conversas de marcação" />
            <Stat
              value={formatRate(metrics.data.bookingRate.rate)}
              label={`Chegaram a horário confirmado (${metrics.data.bookingRate.confirmed} de ${metrics.data.bookingRate.episodesWithIntent})`}
            />
            <Stat
              value={formatRate(metrics.data.attendantCalls.rate)}
              label={`Pediram a equipe (${metrics.data.attendantCalls.episodesWithRequest})`}
            />
            <Stat
              value={String(metrics.data.falseConfirmations.count)}
              label="Falsas confirmações (deve ser 0)"
              tone={metrics.data.falseConfirmations.count > 0 ? 'bad' : undefined}
            />
          </div>
          <div className="admin-stats">
            <Stat
              value={metrics.data.messagesToBook.median === null ? '—' : String(metrics.data.messagesToBook.median)}
              label={`Mensagens até marcar, mediana (referência ${metrics.data.messagesToBook.baseline})`}
            />
            <Stat
              value={metrics.data.misunderstandingsPerConversation.mean === null ? '—' : metrics.data.misunderstandingsPerConversation.mean.toFixed(2)}
              label="Incompreensões por conversa"
            />
            <Stat value={String(metrics.data.abandonedConversations.count)} label="Conversas abandonadas" />
            <Stat
              value={formatRate(metrics.data.attendance.fulfillmentRate)}
              label={`Comparecimento das marcações da IA (${metrics.data.attendance.fulfilled} de ${metrics.data.attendance.aiBooked})`}
            />
          </div>
          {metrics.data.blindSpots.length > 0 ? (
            <section className="admin-card" aria-labelledby="adm-blind">
              <h2 id="adm-blind" className="admin-card-title">O que estas métricas não veem</h2>
              <ul className="admin-dialog-list">
                {metrics.data.blindSpots.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      <div className="admin-grid">
        <section className="admin-card" aria-labelledby="adm-shadow">
          <div className="admin-toolbar">
            <h2 id="adm-shadow" className="admin-card-title admin-toolbar-spacer">Sombra do interpretador (H1)</h2>
            <Pill tone="neutral">Temporário</Pill>
          </div>
          {shadow.phase === 'loading' ? <AdminLoading label="Carregando a sombra…" /> : null}
          {shadow.phase === 'error' ? <AdminLoadError what="a sombra" onRetry={reloadShadow} /> : null}
          {shadow.phase === 'ready' ? (
            shadow.data.summary.total === 0 ? (
              <p className="admin-muted">Sem turnos medidos neste período.</p>
            ) : (
              <>
                <div className="admin-table-scroll">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th scope="col">Campo</th>
                        <th scope="col" className="admin-num">Concorda</th>
                        <th scope="col" className="admin-num">Diverge</th>
                        <th scope="col" className="admin-num">Só LLM</th>
                        <th scope="col" className="admin-num">Só regra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(shadow.data.summary.fields).map(([field, v]) => {
                        const n = (k: ShadowVerdict) => v[k] ?? 0
                        const measured = n('agree') + n('differ') + n('llm_only') + n('rule_only')
                        return (
                          <tr key={field}>
                            <th scope="row">{SHADOW_FIELD_LABEL[field] ?? field}</th>
                            <td className="admin-num">{pct(n('agree'), measured)}</td>
                            <td className="admin-num">{pct(n('differ'), measured)}</td>
                            <td className="admin-num">{pct(n('llm_only'), measured)}</td>
                            <td className="admin-num">{pct(n('rule_only'), measured)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <span className="admin-muted">
                  {shadow.data.summary.total} turnos em {shadow.data.summary.conversations} conversas. Percentagens sobre
                  os turnos em que o campo apareceu. Sem rótulo humano, «Só LLM» e «Diverge» não dizem quem tem razão: é a
                  lista do que rever.
                </span>
              </>
            )
          ) : null}
          {shadow.phase === 'ready' && shadow.data.window.clamped ? (
            <span className="admin-muted" role="note">A sombra só guarda 7 dias: mostra os últimos {shadow.data.window.sinceHours / 24} dias.</span>
          ) : null}
          {shadow.phase === 'ready' && shadow.data.truncated ? (
            <span className="admin-muted" role="note">Resumo truncado: há mais turnos do que o teto do relatório.</span>
          ) : null}
        </section>

        <section className="admin-card" aria-labelledby="adm-samples">
          <div className="admin-toolbar">
            <h2 id="adm-samples" className="admin-card-title admin-toolbar-spacer">Amostras para revisão</h2>
          </div>
          {samples.phase === 'loading' ? <AdminLoading label="Carregando as amostras…" /> : null}
          {samples.phase === 'error' ? <AdminLoadError what="as amostras" onRetry={reloadSamples} /> : null}
          {samples.phase === 'ready' ? (
            (() => {
              const all = [...samples.data.samples, ...(extra?.items ?? [])]
              const next = extra ? extra.next : samples.data.nextBefore
              return all.length === 0 ? (
                <EmptyState title="Sem amostras" description="Ainda não há conversas marcadas para revisão neste filtro." />
              ) : (
                <>
                  <div className="admin-table-scroll">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th scope="col">Amostra</th>
                          <th scope="col">Clínica</th>
                          <th scope="col">Origem</th>
                          <th scope="col">Quando</th>
                        </tr>
                      </thead>
                      <tbody>
                        {all.map((s) => (
                          <tr key={s.id}>
                            <th scope="row">
                              <button type="button" className="admin-link-btn" onClick={() => setOpen(s)}>
                                {s.contactDisplayName || 'Cliente'} · {s.contactPhoneMasked ?? 'sem número'}
                              </button>
                              <span className="admin-muted admin-block">
                                {s.flagReason ?? 'sem motivo'} · {s.messageCount} mensagens
                              </span>
                            </th>
                            <td>{s.tenantName ?? s.tenantId}</td>
                            <td>{SAMPLE_SOURCE_LABEL[s.flagSource] ?? s.flagSource}</td>
                            <td className="admin-nowrap">{formatReading(s.flaggedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {extra?.error ? <p className="admin-dialog-error" role="alert">{extra.error}</p> : null}
                  {next ? (
                    <div>
                      <button type="button" className="admin-btn admin-btn--sm" disabled={extra?.busy} onClick={() => void loadMore()}>
                        {extra?.busy ? 'Carregando…' : 'Carregar mais'}
                      </button>
                    </div>
                  ) : null}
                </>
              )
            })()
          ) : null}
          <div className="admin-note admin-note--warn" role="note">
            <span>
              Abrir uma amostra mostra texto de conversa real (DEC-193) e fica registado na auditoria. O telefone da
              cliente aparece mascarado.
            </span>
          </div>
        </section>
      </div>
      <SampleDialog sample={open} onClose={() => setOpen(null)} />
    </>
  )
}
