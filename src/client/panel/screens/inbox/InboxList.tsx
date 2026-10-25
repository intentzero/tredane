import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Input, SearchField } from 'react-aria-components'
import type { InboxConversation, InboxCounts, InboxFilter, PanelApi } from '../../api'
import { navigatePanel } from '../../routes'
import { EmptyState, ErrorState, LoadingState } from '../../states/StatusScreens'
import {
  assigneeLine,
  contactLabel,
  filterLabel,
  initials,
  previewLine,
  relativeTime,
  statusClass,
  statusLabel,
} from './format'

const FILTERS: InboxFilter[] = ['all', 'new', 'mine', 'unassigned', 'closed']

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  viewerClerkUserId: string
}

export function InboxList({ tenantId, api, generation, viewerClerkUserId }: Props) {
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<InboxConversation[] | null>(null)
  const [counts, setCounts] = useState<InboxCounts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)

  async function load(opts?: { keep?: boolean }) {
    if (!opts?.keep) setLoading(true)
    setError(null)
    try {
      const res = await api.listInboxConversations(
        tenantId,
        { filter, q: q.trim() || undefined, limit: 50 },
        { generation, expectGeneration: () => generation },
      )
      setItems(res.conversations)
      setCounts(res.counts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar conversas')
      if (!opts?.keep) setItems(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [tenantId, generation, filter, q])

  async function seedDemo() {
    setSeeding(true)
    try {
      await api.seedInboxDemo(tenantId, {
        generation,
        expectGeneration: () => generation,
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar demo')
    } finally {
      setSeeding(false)
    }
  }

  if (loading && !items) {
    return <LoadingState label="A carregar conversas…" />
  }

  if (error && !items) {
    return (
      <ErrorState
        title="Não foi possível carregar a caixa de entrada"
        description={error}
        actionLabel="Tentar de novo"
        onAction={() => void load()}
      />
    )
  }

  const list = items ?? []
  const emptyAll = list.length === 0 && filter === 'all' && !q.trim()

  return (
    <div className="inbox-root">
      <SearchField
        className="inbox-search"
        aria-label="Buscar nome ou telefone"
        value={q}
        onChange={setQ}
      >
        <Search aria-hidden size={18} strokeWidth={2} className="inbox-search-icon" />
        <Input className="inbox-search-input" placeholder="Buscar nome ou telefone" />
      </SearchField>

      <div
        className="inbox-filters"
        role="toolbar"
        aria-label="Filtros da caixa de entrada"
      >
        {FILTERS.map((f) => {
          const count =
            counts == null
              ? null
              : f === 'all'
                ? counts.all
                : f === 'new'
                  ? counts.new
                  : f === 'mine'
                    ? counts.mine
                    : f === 'unassigned'
                      ? counts.unassigned
                      : counts.closed
          const selected = filter === f
          return (
            <Button
              key={f}
              className={`panel-chip${selected ? ' inbox-chip-active' : ''}`}
              aria-pressed={selected}
              onPress={() => setFilter(f)}
            >
              {filterLabel(f)}
              {f === 'new' && count != null && count > 0 ? ` · ${count}` : ''}
            </Button>
          )
        })}
      </div>

      {list.length === 0 ? (
        <EmptyState
          title={emptyAll ? 'Nenhuma conversa ainda' : 'Nenhuma conversa neste filtro'}
          description={
            emptyAll
              ? 'Mensagens enviadas ao WhatsApp da clínica aparecem aqui. Pode carregar dados sintéticos de demonstração.'
              : 'Tente outro filtro ou limpe a busca.'
          }
          actionLabel={emptyAll ? (seeding ? 'A carregar…' : 'Carregar demonstração') : 'Limpar filtro'}
          onAction={
            emptyAll
              ? () => void seedDemo()
              : () => {
                  setFilter('all')
                  setQ('')
                }
          }
        />
      ) : (
        <ul className="inbox-list">
          {list.map((c) => {
            const label = contactLabel(c.contact)
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className="inbox-row"
                  onClick={() =>
                    navigatePanel({
                      kind: 'area',
                      area: 'conversas',
                      tenantId,
                      section: 'thread',
                      conversationId: c.id,
                    })
                  }
                >
                  <span className="inbox-avatar" aria-hidden>
                    {initials(label)}
                  </span>
                  <span className="inbox-row-main">
                    <span className="inbox-row-top">
                      <span className="inbox-row-name">{label}</span>
                      <span className="inbox-row-time">{relativeTime(c.lastMessageAt)}</span>
                    </span>
                    <span className="inbox-row-preview">
                      {previewLine(c, viewerClerkUserId)}
                    </span>
                    <span className="inbox-row-meta">
                      <span className={statusClass(c.status)}>{statusLabel(c.status)}</span>
                      <span className="inbox-row-assignee">
                        {assigneeLine(c, viewerClerkUserId)}
                      </span>
                      {c.unreadCount > 0 ? (
                        <span className="inbox-unread" aria-label={`${c.unreadCount} não lidas`}>
                          {c.unreadCount}
                        </span>
                      ) : null}
                    </span>
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
