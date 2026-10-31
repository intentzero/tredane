import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Input, SearchField } from 'react-aria-components'
import type { InboxContact, PanelApi } from '../../api'
import { navigatePanel } from '../../routes'
import { EmptyState, ErrorState } from '../../states/StatusScreens'
import { ListSkeleton } from '../../states/ListSkeleton'
import { Badge } from '../../states/Badge'
import { friendlyError } from '../../copy/errors'
import {
  avatarTone,
  contactLabel,
  initials,
  maskPhone,
} from '../inbox/format'

type Filter = 'all' | 'with_appointment' | 'blocked'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'with_appointment', label: 'Com horário' },
  { id: 'blocked', label: 'Bloqueadas' },
]

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  activeContactId?: string
}

/**
 * Lista Clientes (fase 1, Opção C Confirmada): directório só leitura + busca.
 */
export function ClientesList({ tenantId, api, generation, activeContactId }: Props) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [items, setItems] = useState<InboxContact[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const handle = window.setTimeout(() => {
      void (async () => {
        setLoading(true)
        setError(null)
        try {
          const res = await api.listInboxContacts(
            tenantId,
            { q: q.trim() || undefined, filter },
            { generation, expectGeneration: () => generation },
          )
          if (!cancelled) setItems(res.contacts)
        } catch (err) {
          if (!cancelled) {
            setError(friendlyError(err, 'Não foi possível carregar os clientes.'))
            setItems(null)
          }
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }, q.trim() ? 200 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [api, tenantId, generation, q, filter])

  if (loading && !items) {
    return <ListSkeleton label="Carregando clientes…" />
  }

  if (error && !items) {
    return (
      <ErrorState
        title="Não foi possível carregar os clientes"
        description={error}
        actionLabel="Tentar de novo"
        onAction={() => {
          setItems(null)
          setError(null)
          setLoading(true)
          void api
            .listInboxContacts(
              tenantId,
              { q: q.trim() || undefined, filter },
              { generation, expectGeneration: () => generation },
            )
            .then((res) => setItems(res.contacts))
            .catch((err) =>
              setError(friendlyError(err, 'Não foi possível carregar os clientes.')),
            )
            .finally(() => setLoading(false))
        }}
      />
    )
  }

  const list = items ?? []
  const emptyAll = list.length === 0 && filter === 'all' && !q.trim()

  return (
    <div className="inbox-root clientes-list">
      <SearchField
        className="inbox-search"
        aria-label="Buscar nome ou telefone"
        value={q}
        onChange={setQ}
      >
        <Search aria-hidden size={18} strokeWidth={2} className="inbox-search-icon" />
        <Input
          className="inbox-search-input"
          placeholder="Buscar nome ou telefone"
          autoComplete="off"
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore
        />
      </SearchField>

      <div className="inbox-filters" role="toolbar" aria-label="Filtros de clientes">
        {FILTERS.map((f) => {
          const selected = filter === f.id
          return (
            <Button
              key={f.id}
              className="panel-chip"
              aria-pressed={selected}
              onPress={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          )
        })}
      </div>

      {list.length === 0 ? (
        <EmptyState
          title={emptyAll ? 'Nenhum cliente ainda' : 'Nenhum cliente neste filtro'}
          description={
            emptyAll
              ? 'Os contatos aparecem aqui quando chegam pelo WhatsApp ou são marcados na agenda.'
              : 'Tente outro filtro ou limpe a busca.'
          }
        />
      ) : (
        <ul className="inbox-list">
          {list.map((c) => {
            const label = contactLabel(c)
            const active = c.id === activeContactId
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={`inbox-row${active ? ' inbox-row--active' : ''}`}
                  aria-current={active ? 'true' : undefined}
                  onClick={() =>
                    navigatePanel({
                      kind: 'area',
                      area: 'clientes',
                      tenantId,
                      section: 'ficha',
                      contactId: c.id,
                    })
                  }
                >
                  <span
                    className={`inbox-avatar inbox-avatar-tone-${avatarTone(label)}`}
                    aria-hidden
                  >
                    {initials(label)}
                  </span>
                  <span className="inbox-row-main">
                    <span className="inbox-row-top">
                      <span className="inbox-row-name">{label}</span>
                      {c.blockedAt != null ? (
                        <Badge tone="wait">Bloqueada</Badge>
                      ) : null}
                    </span>
                    <span className="inbox-row-preview">{maskPhone(c.waId)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
