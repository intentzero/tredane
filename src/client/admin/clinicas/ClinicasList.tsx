import { useEffect, useMemo, useState } from 'react'
import { useAdminApi } from '../useAdminApi'
import type { AdminTenantRow } from '../api'
import { AdminLoadError, AdminLoading, PageHeader, Pill } from '../AdminUi'
import {
  CHANNEL_LABEL,
  CHANNEL_TONE,
  FILTERS,
  STATE_LABEL,
  STATE_TONE,
  foldText,
  formatDate,
  tenantDisplayState,
  type StateFilter,
} from '../format'
import { clinicaHref, navigateAdmin } from '../routes'
import { EmptyState } from '../../panel/states/StatusScreens'

type Load = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; rows: AdminTenantRow[] }

export function ClinicasList() {
  const api = useAdminApi()
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StateFilter>('all')

  useEffect(() => {
    const controller = new AbortController()
    setLoad({ phase: 'loading' })
    api
      .listTenants({ signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) setLoad({ phase: 'ready', rows })
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ phase: 'error' })
      })
    return () => controller.abort()
  }, [api, attempt])

  const rows = load.phase === 'ready' ? load.rows : []
  const counts = useMemo(() => {
    const c: Record<StateFilter, number> = {
      all: rows.length,
      active: 0,
      onboarding: 0,
      suspended: 0,
      pending_deletion: 0,
    }
    for (const r of rows) c[tenantDisplayState(r)] += 1
    return c
  }, [rows])

  const visible = useMemo(() => {
    const needle = foldText(query)
    return rows.filter(
      (r) =>
        (filter === 'all' || tenantDisplayState(r) === filter) &&
        (!needle || foldText(r.name).includes(needle)),
    )
  }, [rows, filter, query])

  if (load.phase === 'loading') return <AdminLoading label="Carregando as clínicas…" />
  if (load.phase === 'error') {
    return <AdminLoadError what="as clínicas" onRetry={() => setAttempt((n) => n + 1)} />
  }

  return (
    <>
      <PageHeader
        title="Clínicas"
        sub={`${rows.length} ${rows.length === 1 ? 'clínica' : 'clínicas'}`}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="Ainda não há clínicas"
          description="As clínicas criadas pela Platform Admin aparecem aqui."
        />
      ) : (
        <>
          <div className="admin-toolbar">
            <label className="admin-search">
              <span className="admin-visually-hidden">Buscar por nome</span>
              <input
                type="search"
                placeholder="Buscar por nome"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="admin-seg" role="group" aria-label="Estado">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label} {counts[f.id]}
                </button>
              ))}
            </div>
          </div>
          {visible.length === 0 ? (
            <EmptyState
              title="Nenhuma clínica encontrada"
              description="Mude a busca ou o filtro de estado."
            />
          ) : (
            <div className="admin-card admin-card--flush">
              <div className="admin-table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Clínica</th>
                      <th scope="col">Estado</th>
                      <th scope="col">WhatsApp</th>
                      <th scope="col" className="admin-num">Owners</th>
                      <th scope="col" className="admin-num">Membros</th>
                      <th scope="col">Criada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const state = tenantDisplayState(r)
                      const href = clinicaHref(r.id)
                      return (
                        <tr key={r.id}>
                          <th scope="row">
                            <a
                              href={href}
                              onClick={(e) => {
                                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                                e.preventDefault()
                                navigateAdmin(href)
                              }}
                            >
                              {r.name}
                            </a>
                          </th>
                          <td><Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill></td>
                          <td>
                            <Pill tone={CHANNEL_TONE[r.whatsapp.status]}>
                              {CHANNEL_LABEL[r.whatsapp.status]}
                            </Pill>
                          </td>
                          <td className="admin-num">{r.ownerCount}</td>
                          <td className="admin-num">{r.memberCount}</td>
                          <td>{formatDate(r.createdAt)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
