import { Fragment, useCallback, useEffect, useState } from 'react'
import { EmptyState } from '../../panel/states/StatusScreens'
import { adminErrorMessage, type AuditCategory, type AuditEvent } from '../api'
import { AdminLoadError, AdminLoading, Pill } from '../AdminUi'
import {
  AUDIT_CATEGORIES,
  AUDIT_OUTCOME,
  auditActionLabel,
  auditPerson,
  formatReading,
} from '../format'
import { useAdminApi } from '../useAdminApi'

type Days = 7 | 30 | 90
type Load =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; events: AuditEvent[]; nextCursor: string | null }

const PAGE = 50

/** Aba Auditoria da clínica (PA-11): só leitura, por período e tipo, com «Carregar mais». */
export function AuditoriaTab({ tenantId }: { tenantId: string }) {
  const api = useAdminApi()
  const [category, setCategory] = useState<AuditCategory | 'all'>('all')
  const [days, setDays] = useState<Days>(30)
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [more, setMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoad({ phase: 'loading' })
    setOpenId(null)
    setMore({ busy: false, error: null })
    api
      .listAudit(tenantId, { category: category === 'all' ? undefined : category, days, limit: PAGE }, { signal: controller.signal })
      .then((page) => {
        if (!controller.signal.aborted) setLoad({ phase: 'ready', events: page.events, nextCursor: page.nextCursor })
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ phase: 'error' })
      })
    return () => controller.abort()
  }, [api, tenantId, category, days, attempt])

  const loadMore = useCallback(async () => {
    if (load.phase !== 'ready' || !load.nextCursor) return
    setMore({ busy: true, error: null })
    try {
      const page = await api.listAudit(tenantId, {
        category: category === 'all' ? undefined : category,
        days,
        cursor: load.nextCursor,
        limit: PAGE,
      })
      setLoad((prev) => {
        if (prev.phase !== 'ready') return prev
        const seen = new Set(prev.events.map((e) => e.id))
        return { phase: 'ready', events: [...prev.events, ...page.events.filter((e) => !seen.has(e.id))], nextCursor: page.nextCursor }
      })
      setMore({ busy: false, error: null })
    } catch (err) {
      setMore({ busy: false, error: adminErrorMessage(err) })
    }
  }, [api, tenantId, category, days, load])

  return (
    <>
      <div className="admin-toolbar">
        <label className="admin-field admin-inline-field">
          <span className="admin-visually-hidden">Período</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value) as Days)} aria-label="Período">
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </label>
        <div className="admin-seg" role="group" aria-label="Tipo de evento">
          {AUDIT_CATEGORIES.map((c) => (
            <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {load.phase === 'loading' ? <AdminLoading label="Carregando a auditoria…" /> : null}
      {load.phase === 'error' ? <AdminLoadError what="a auditoria" onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {load.phase === 'ready' && load.events.length === 0 ? (
        <EmptyState
          title="Sem eventos neste período"
          description="Mude o período ou o tipo de evento para ver outros."
        />
      ) : null}
      {load.phase === 'ready' && load.events.length > 0 ? (
        <div className="admin-card admin-card--flush">
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Ator</th>
                  <th scope="col">Sobre quem</th>
                  <th scope="col">Ação</th>
                  <th scope="col">Resultado</th>
                  <th scope="col">Sessão / pedido</th>
                </tr>
              </thead>
              <tbody>
                {load.events.map((e) => {
                  const outcome = AUDIT_OUTCOME[e.outcome] ?? { label: e.outcome, tone: 'neutral' as const }
                  const open = openId === e.id
                  const entries = Object.entries(e.metadata)
                  return (
                    <Fragment key={e.id}>
                      <tr>
                        <td className="admin-nowrap">{formatReading(e.occurredAt)}</td>
                        <td>{auditPerson(e.actor)}</td>
                        <td>{e.subject ? auditPerson(e.subject) : '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="admin-link-btn"
                            aria-expanded={open}
                            aria-controls={`audit-${e.id}`}
                            onClick={() => setOpenId(open ? null : e.id)}
                          >
                            {auditActionLabel(e.action)}
                          </button>
                        </td>
                        <td><Pill tone={outcome.tone}>{outcome.label}</Pill></td>
                        <td><code>{e.supportSessionId ?? '—'}</code></td>
                      </tr>
                      {open ? (
                        <tr id={`audit-${e.id}`} className="admin-audit-detail">
                          <td />
                          <td colSpan={5}>
                            <dl className="admin-kv admin-kv--compact">
                              <dt>Ação técnica</dt>
                              <dd><code>{e.action}</code></dd>
                              <dt>Objeto</dt>
                              <dd>{e.objectType}{e.objectId ? <> · <code>{e.objectId}</code></> : null}</dd>
                              {entries.map(([k, v]) => (
                                <Fragment key={k}>
                                  <dt>{k}</dt>
                                  <dd>{v === null ? '—' : String(v)}</dd>
                                </Fragment>
                              ))}
                            </dl>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="admin-toolbar">
        <span className="admin-muted admin-toolbar-spacer">
          A auditoria não guarda conteúdo de conversas. Só leitura.
          {more.error ? <span className="admin-field-error" role="alert"> {more.error}</span> : null}
        </span>
        {load.phase === 'ready' && load.nextCursor ? (
          <button type="button" className="admin-btn" disabled={more.busy} onClick={() => void loadMore()}>
            {more.busy ? 'Carregando…' : 'Carregar mais'}
          </button>
        ) : null}
      </div>
    </>
  )
}
